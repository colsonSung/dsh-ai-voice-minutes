import AppKit
import Combine
import Darwin
import Foundation
import SwiftUI

private let maximumTranscriptRows = 100
private let maximumLevelSamples = 56
/// The captions have to win over whatever is behind them, so the window never
/// goes below this much opacity even if the setting asks for it.
private let minimumOverlayOpacity = 0.85
private let compactWindowSize = NSSize(width: 500, height: 340)
private let expandedWindowSize = NSSize(width: 920, height: 520)

struct OverlayNotice: Equatable {
    var phase: String
    var text: String
}

struct OverlayRow: Identifiable, Equatable {
    let id: String
    var original: String
    var translation: String
    var level: Double
}

/// What the card shows: the original, the translation, or both.
enum OverlayDisplay: String {
    case original
    case translation
    case both
}

/// The overlay's colours and default layout, controlled from the plugin settings.
struct OverlayAppearance: Equatable {
    var background: String = "#f6f6f7"
    var text: String = "#1c1c1e"
    var opacity: Double = 1
    var compact: Bool = true

    var backgroundColor: Color {
        Color(hex: background) ?? Color(red: 0.965, green: 0.965, blue: 0.969)
    }

    var textColor: Color {
        Color(hex: text) ?? Color(red: 0.11, green: 0.11, blue: 0.12)
    }

    /// True when the background is bright enough to need dark text on top of it.
    var isLight: Bool {
        guard let color = Color(hex: background) else { return true }
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        NSColor(color).getRed(&red, green: &green, blue: &blue, alpha: nil)
        return (0.299 * red + 0.587 * green + 0.114 * blue) > 0.6
    }
}

extension Color {
    /// Read a #RRGGBB or #RRGGBBAA colour. Returns nil when it cannot be parsed.
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6 || value.count == 8, let number = UInt64(value, radix: 16) else { return nil }
        let hasAlpha = value.count == 8
        let red = Double((number >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let green = Double((number >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let blue = Double((number >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let alpha = hasAlpha ? Double(number & 0xFF) / 255 : 1
        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

enum OverlayEvent {
    case transcript(id: String?, text: String, level: Double)
    case translation(id: String?, text: String, original: String)
    case status(String)
    case error(String)
    case session(startedAt: Date?)
    case state(paused: Bool, live: Bool, stopping: Bool, language: String, languages: [String])
    case appearance(OverlayAppearance)
    case level(Double)
    case notice(phase: String, text: String)
    case language(String, [String])
    case control(String, String)
    case close
}

enum OverlayParseError: LocalizedError {
    case invalidJSON
    case invalidEvent

    var errorDescription: String? {
        switch self {
        case .invalidJSON:
            return "line is not valid JSON"
        case .invalidEvent:
            return "event must be an object with a string type"
        }
    }
}

enum OverlayParser {
    static func parse(_ line: String) throws -> OverlayEvent? {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data)
        else {
            throw OverlayParseError.invalidJSON
        }
        guard let dictionary = object as? [String: Any],
              let type = dictionary["type"] as? String
        else {
            throw OverlayParseError.invalidEvent
        }

        let id = rowID(for: dictionary)
        switch type {
        case "transcript":
            let level = (dictionary["level"] as? NSNumber)?.doubleValue ?? 0
            return .transcript(
                id: id,
                text: dictionary["text"] as? String ?? "",
                level: min(1, max(0, level))
            )
        case "translation":
            let translated = dictionary["translation"] as? String ?? dictionary["text"] as? String ?? ""
            return .translation(
                id: id,
                text: translated,
                original: dictionary["transcript"] as? String ?? ""
            )
        case "status":
            return .status(dictionary["detail"] as? String ?? "")
        case "error":
            return .error(dictionary["detail"] as? String ?? "")
        case "session":
            let startedAt = (dictionary["startedAt"] as? NSNumber)
                .map { Date(timeIntervalSince1970: $0.doubleValue / 1000) }
            return .session(startedAt: startedAt)
        case "state":
            return .state(
                paused: dictionary["paused"] as? Bool ?? false,
                live: dictionary["live"] as? Bool ?? true,
                stopping: dictionary["stopping"] as? Bool ?? false,
                language: dictionary["language"] as? String ?? "",
                languages: (dictionary["languages"] as? [String]) ?? []
            )
        case "appearance":
            var appearance = OverlayAppearance()
            if let background = dictionary["background"] as? String, !background.isEmpty {
                appearance.background = background
            }
            if let text = dictionary["text"] as? String, !text.isEmpty {
                appearance.text = text
            }
            if let opacity = dictionary["opacity"] as? NSNumber {
                // Below about 85% the desktop shows through the caption itself,
                // which is exactly what makes a floating transcript unreadable.
                appearance.opacity = min(1, max(minimumOverlayOpacity, opacity.doubleValue))
            }
            if let compact = dictionary["compact"] as? Bool {
                appearance.compact = compact
            }
            return .appearance(appearance)
        case "level":
            let level = (dictionary["level"] as? NSNumber)?.doubleValue ?? 0
            return .level(min(1, max(0, level)))
        case "notice":
            return .notice(
                phase: dictionary["phase"] as? String ?? "ready",
                text: dictionary["text"] as? String ?? ""
            )
        case "language":
            let code = dictionary["language"] as? String ?? ""
            let languages = (dictionary["languages"] as? [String]) ?? []
            return .language(code, languages)
        case "control":
            let detail = dictionary["detail"] as? String ?? ""
            if detail == "close" { return .close }
            if detail.isEmpty { return nil }
            return .control(detail, dictionary["value"] as? String ?? "")
        default:
            return nil
        }
    }

    private static func rowID(for dictionary: [String: Any]) -> String? {
        if let chunkID = stringValue(dictionary["chunkId"]) {
            let source = stringValue(dictionary["source"]) ?? "unknown"
            return "chunk:\(source):\(chunkID)"
        }
        if let sequence = stringValue(dictionary["seq"]) {
            return "sequence:\(sequence)"
        }
        return nil
    }

    private static func stringValue(_ value: Any?) -> String? {
        if let string = value as? String {
            return string
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        return nil
    }
}

final class OverlayModel: ObservableObject {
    @Published private(set) var rows: [OverlayRow] = []
    @Published private(set) var status = "Waiting for input"
    @Published private(set) var errorMessage: String?
    @Published private(set) var levels: [Double] = []
    @Published private(set) var translationLanguage = ""
    @Published private(set) var languages: [String] = []
    @Published var display: OverlayDisplay = .both
    @Published private(set) var appearance = OverlayAppearance()
    @Published private(set) var paused = false
    @Published private(set) var live = false
    @Published private(set) var stopping = false
    @Published private(set) var notice: OverlayNotice?
    @Published private(set) var sessionStartedAt: Date?
    @Published private(set) var sessionEndedAt: Date?
    @Published var expanded = false

    /// Called when the reader presses pause, resume, stop or a language pick.
    var onCommand: ((String, String) -> Void)?

    /// Ask the plugin to act on a control the reader pressed.
    func sendCommand(_ detail: String, _ value: String = "") {
        onCommand?(detail, value)
    }

    /// Ask the plugin to translate the meeting into another language.
    func selectLanguage(_ code: String) {
        translationLanguage = code
        sendCommand("language", code)
    }

    /// Show the original, the translation, or both.
    func setDisplay(_ value: OverlayDisplay) {
        display = value
    }

    /// The newest line, which is what the compact view shows.
    var latest: OverlayRow? {
        rows.last
    }

    /// Applies one JSONL line. Returns true only for a close control event.
    @discardableResult
    func handle(line: String) -> Bool {
        guard !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return false
        }
        do {
            guard let event = try OverlayParser.parse(line) else {
                return false
            }
            return apply(event)
        } catch {
            errorMessage = "Invalid JSONL input: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    private func apply(_ event: OverlayEvent) -> Bool {
        switch event {
        case let .transcript(id, text, level):
            updateRow(id: id, original: text, translation: nil, level: level)
        case let .translation(id, text, original):
            updateRow(id: id, original: original.isEmpty ? nil : original, translation: text, level: nil)
        case let .status(detail):
            status = detail.isEmpty ? "Status updated" : detail
        case let .error(detail):
            errorMessage = detail.isEmpty ? "Unknown error" : detail
        case let .session(startedAt):
            sessionStartedAt = startedAt
            sessionEndedAt = nil
            notice = nil
            live = startedAt != nil
        case let .state(isPaused, isLive, isStopping, language, list):
            if isStopping && !stopping { sessionEndedAt = Date() }
            if isLive && !isStopping { sessionEndedAt = nil }
            paused = isPaused
            live = isLive
            stopping = isStopping
            if !language.isEmpty { translationLanguage = language }
            if !list.isEmpty { languages = list }
        case let .appearance(value):
            appearance = value
            expanded = !value.compact
        case let .level(value):
            recordLevel(value)
        case let .notice(phase, text):
            notice = OverlayNotice(phase: phase, text: text)
            stopping = false
        case let .language(code, list):
            translationLanguage = code
            languages = list
        case let .control(detail, value):
            onCommand?(detail, value)
        case .close:
            return true
        }
        return false
    }

    private func updateRow(id: String?, original: String?, translation: String?, level: Double?) {
        var index: Int?
        if let id {
            index = rows.firstIndex(where: { $0.id == id })
        }
        if index == nil, translation != nil, let original, !original.isEmpty {
            index = rows.lastIndex(where: { $0.original == original && $0.translation.isEmpty })
        }

        if let index {
            if let original {
                rows[index].original = original
            }
            if let translation {
                rows[index].translation = translation
            }
            if let level {
                rows[index].level = level
            }
        } else {
            rows.append(OverlayRow(
                id: id ?? "row:\(UUID().uuidString)",
                original: original ?? "",
                translation: translation ?? "",
                level: level ?? 0
            ))
        }

        if rows.count > maximumTranscriptRows {
            rows.removeFirst(rows.count - maximumTranscriptRows)
        }
    }

    /// Keep a short history of the live levels so the overlay can draw a
    /// waveform that moves with the voice.
    private func recordLevel(_ level: Double) {
        levels.append(level)
        if levels.count > maximumLevelSamples {
            levels.removeFirst(levels.count - maximumLevelSamples)
        }
    }
}

/// The window geometry the reader chose, kept between launches.
struct OverlayWindowState: Codable {
    var x: Double?
    var y: Double?
    var width: Double = compactWindowSize.width
    var height: Double = compactWindowSize.height
    var expanded: Bool = false
    var display: String = OverlayDisplay.both.rawValue
}

/// Lets the SwiftUI layer move and resize the overlay window.
final class OverlayWindowController: ObservableObject {
    weak var window: NSWindow?

    @MainActor
    func move(by delta: CGSize) {
        guard let window else { return }
        window.setFrameOrigin(CGPoint(
            x: window.frame.origin.x + delta.width,
            y: window.frame.origin.y - delta.height
        ))
    }

    @MainActor
    func resize(by delta: CGSize) {
        guard let window else { return }
        var frame = window.frame
        frame.size.width = max(window.minSize.width, frame.size.width + delta.width)
        frame.size.height = max(window.minSize.height, frame.size.height + delta.height)
        window.setFrame(frame, display: true)
    }

    /// Grow the window to the transcript layout, or shrink it back to the card.
    @MainActor
    func setExpanded(_ expanded: Bool) {
        guard let window else { return }
        let target = expanded ? expandedWindowSize : compactWindowSize
        var frame = window.frame
        // The transcript needs the room and the card does not, but a size the
        // reader chose by hand is kept as long as it still works.
        if expanded {
            frame.size.width = max(frame.size.width, target.width)
            frame.size.height = max(frame.size.height, target.height)
        } else {
            frame.size.width = min(frame.size.width, target.width)
            frame.size.height = min(frame.size.height, target.height)
        }
        let top = frame.maxY
        frame.origin.y = top - frame.size.height
        window.setFrame(frame, display: true, animate: true)
    }
}

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ContentHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct ViewportHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

/// Width of the transcript content, measured inside the ScrollView. The column
/// header is laid out outside it, so this is the only width the two can agree
/// on once a scrollbar starts taking room away from the rows.
private struct ContentWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct FloatingOverlayView: View {
    @ObservedObject var model: OverlayModel
    @ObservedObject var controller: OverlayWindowController

    @State private var scrollOffset: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    @State private var viewportHeight: CGFloat = 0
    @State private var contentWidth: CGFloat = 0
    @State private var dragOrigin: CGSize = .zero
    @State private var now = Date()

    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var background: Color { model.appearance.backgroundColor }
    private var text: Color { model.appearance.textColor }
    private var secondary: Color { text.opacity(0.55) }

    /// True while the transcript is scrolled to the newest line.
    private var isAtBottom: Bool {
        scrollOffset + viewportHeight >= contentHeight - 48
    }

    private var elapsed: TimeInterval {
        guard let startedAt = model.sessionStartedAt else { return 0 }
        // Stop is a real state, not just a disabled button: the clock freezes
        // at the moment the reader ends the recording.
        let end = model.sessionEndedAt ?? now
        return max(0, end.timeIntervalSince(startedAt))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let notice = model.notice {
                noticeBody(notice)
            } else if model.stopping {
                stoppingBody
            } else if model.expanded {
                expandedBody
            } else {
                compactBody
            }
            controlBar
        }
        .background(
            background.overlay(
                LinearGradient(
                    colors: [text.opacity(0.025), Color.clear, accent.opacity(0.025)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
        )
        .foregroundColor(text)
        .onReceive(ticker) { now = $0 }
        .onChange(of: model.expanded) { expanded in
            controller.setExpanded(expanded)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 15))
                .foregroundColor(text.opacity(0.85))
            Text("Live Transcript")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            if model.live {
                Text("LIVE")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .tracking(1.1)
                    .foregroundColor(Color(red: 0.16, green: 0.66, blue: 0.40))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.green.opacity(0.16)))
            }
            if model.notice == nil && !model.stopping {
                displaySwitch
                if model.display != .original, model.languages.count > 1 {
                    languagePicker
                }
            }
            Button { toggleExpanded() } label: {
                Image(systemName: model.expanded ? "chevron.down" : "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(text.opacity(0.65))
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: 6).fill(text.opacity(0.07)))
            }
            .buttonStyle(.plain)
            .help(model.expanded ? "Collapse" : "Expand")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .gesture(dragGesture)
    }

    // MARK: - What the card shows

    private var displaySwitch: some View {
        HStack(spacing: 2) {
            ForEach([OverlayDisplay.original, .translation, .both], id: \.self) { option in
                Button { model.setDisplay(option) } label: {
                    Text(label(for: option))
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(model.display == option ? accent : text.opacity(0.55))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(RoundedRectangle(cornerRadius: 5)
                            .fill(model.display == option ? accent.opacity(0.16) : Color.clear))
                }
                .buttonStyle(.plain)
            }
        }
        .background(RoundedRectangle(cornerRadius: 7).fill(text.opacity(0.05)))
    }

    private var languagePicker: some View {
        Menu {
            ForEach(model.languages, id: \.self) { code in
                Button {
                    model.selectLanguage(code)
                } label: {
                    Text(code.uppercased())
                }
            }
        } label: {
            Text(model.translationLanguage.isEmpty ? "—" : model.translationLanguage.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(text.opacity(0.65))
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(RoundedRectangle(cornerRadius: 7).fill(text.opacity(0.05)))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    private func label(for display: OverlayDisplay) -> String {
        switch display {
        case .original: return "Original"
        case .translation: return "Translation"
        case .both: return "Both"
        }
    }

    // MARK: - Compact card

    private var stoppingBody: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(accent.opacity(0.10))
                    .frame(width: 52, height: 52)
                ProgressView()
                    .controlSize(.regular)
                    .tint(accent)
            }
            Text("Ending recording")
                .font(.system(size: 17, weight: .semibold, design: .rounded))
            Text("Finishing the last captions and saving your audio…")
                .font(.system(size: 12))
                .foregroundColor(secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
    }

    private func noticeBody(_ notice: OverlayNotice) -> some View {
        let ready = notice.phase == "ready"
        return VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill((ready ? Color.green : accent).opacity(0.12))
                    .frame(width: 56, height: 56)
                if ready {
                    Image(systemName: "checkmark")
                        .font(.system(size: 23, weight: .bold))
                        .foregroundColor(Color(red: 0.12, green: 0.62, blue: 0.36))
                } else {
                    ProgressView()
                        .controlSize(.regular)
                        .tint(accent)
                }
            }
            Text(ready ? "All set" : "Preparing your minutes")
                .font(.system(size: 18, weight: .semibold, design: .rounded))
            Text(notice.text)
                .font(.system(size: 12.5))
                .foregroundColor(secondary)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .frame(maxWidth: 330)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }

    private var compactBody: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                Circle()
                    .fill(model.live ? Color.green : secondary)
                    .frame(width: 5, height: 5)
                Text(model.display == .translation ? "TRANSLATION" : "LIVE CAPTION")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .tracking(1.2)
                    .foregroundColor(secondary)
                Spacer()
                if model.live {
                    Text("Listening")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(secondary)
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                    if model.display != .translation {
                        Text(model.latest?.original ?? "Start speaking — your caption will appear here.")
                            .font(.system(size: 18, weight: .medium, design: .rounded))
                            .lineSpacing(5)
                            .foregroundColor(model.latest == nil ? secondary : text)
                            .minimumScaleFactor(0.85)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if model.display == .both {
                        Rectangle()
                            .fill(text.opacity(0.08))
                            .frame(height: 1)
                    }
                    if model.display != .original {
                        VStack(alignment: .leading, spacing: 6) {
                            if model.display == .both {
                                Text(model.translationLanguage.isEmpty ? "TRANSLATION" : model.translationLanguage.uppercased())
                                    .font(.system(size: 9, weight: .bold, design: .rounded))
                                    .tracking(1.0)
                                    .foregroundColor(accent.opacity(0.8))
                            }
                            Text(model.latest?.translation ?? "Translation will follow the original.")
                                .font(.system(size: 13.5, weight: .regular))
                                .lineSpacing(4)
                                .foregroundColor(model.latest?.translation.isEmpty == false ? text.opacity(0.72) : secondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)

            // No plate behind the meter: it is a transient signal, and a filled
            // block at the bottom of the card read louder than the captions it
            // is supposed to support.
            levelStrip
                .padding(.horizontal, 2)
                .padding(.vertical, 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    /// A live waveform: the last few seconds of the room, scrolling as the
    /// voice comes and goes.
    private var levelStrip: some View {
        let levels = model.levels
        let slots = maximumLevelSamples
        let first = slots - min(slots, levels.count)
        // A waveform, not two crossing lines: every sample is a bar that
        // straddles the centre line, and the bar is as tall as the voice was.
        return Canvas { context, size in
            let middle = size.height / 2
            // No centre rule: the bars straddle the middle anyway, so a full
            // width line only added one more line to the card.
            let step = size.width / CGFloat(max(1, slots))
            for index in 0..<slots {
                guard index >= first else { continue }
                let level = levels[index - first]
                let amplitude = max(0.4, level * (middle - 0.5))
                let x = step * (CGFloat(index) + 0.5)
                var bar = Path()
                bar.move(to: CGPoint(x: x, y: middle - amplitude))
                bar.addLine(to: CGPoint(x: x, y: middle + amplitude))
                // Quiet enough that the captions stay the loudest thing in the
                // window: the voice shows as a fine texture, not as a graph.
                let color = level > 0.06 ? accent.opacity(0.38) : text.opacity(0.12)
                context.stroke(
                    bar,
                    with: .color(color),
                    style: StrokeStyle(lineWidth: 1.1, lineCap: .round)
                )
            }
        }
        .frame(height: 12, alignment: .center)
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.linear(duration: 0.09), value: model.levels)
    }

    // MARK: - Expanded transcript

    private var expandedBody: some View {
        VStack(spacing: 0) {
            // The header sits outside the scroll area, so it has to be pinned
            // to the width the rows are actually laid out at: a visible
            // scrollbar narrows the rows, and a full-width header then splits
            // its two columns at a different point than the rows do.
            columnHeaders
                .frame(width: contentWidth > 0 ? contentWidth : nil, alignment: .leading)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        GeometryReader { geometry in
                            Color.clear.preference(
                                key: ScrollOffsetKey.self,
                                value: -geometry.frame(in: .named("transcript")).minY
                            )
                        }
                        .frame(height: 0)
                        if model.rows.isEmpty {
                            VStack(spacing: 8) {
                                Image(systemName: "text.bubble")
                                    .font(.system(size: 26, weight: .light))
                                Text("Transcript events will appear here")
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 56)
                        } else {
                            ForEach(model.rows) { row in
                                transcriptRow(row)
                            }
                        }
                    }
                    .background(GeometryReader { geometry in
                        Color.clear
                            .preference(key: ContentHeightKey.self, value: geometry.size.height)
                            .preference(key: ContentWidthKey.self, value: geometry.size.width)
                    })
                }
                .coordinateSpace(name: "transcript")
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: ViewportHeightKey.self, value: geometry.size.height)
                })
                .onPreferenceChange(ScrollOffsetKey.self) { scrollOffset = $0 }
                .onPreferenceChange(ContentHeightKey.self) { contentHeight = $0 }
                .onPreferenceChange(ViewportHeightKey.self) { viewportHeight = $0 }
                .onPreferenceChange(ContentWidthKey.self) { contentWidth = $0 }
                .onChange(of: model.rows.count) { _ in
                    // Only follow the newest line while the reader is at the bottom,
                    // so scrolling back through the conversation is not undone.
                    guard isAtBottom, let lastID = model.rows.last?.id else { return }
                    withAnimation(.easeOut(duration: 0.15)) {
                        proxy.scrollTo(lastID, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var columnHeaders: some View {
        HStack(spacing: 0) {
            Text("Original")
                .padding(.leading, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
            Rectangle()
                .fill(text.opacity(0.12))
                .frame(width: 1, height: 16)
            Text("Translation")
                .padding(.leading, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.system(size: 11, weight: .semibold))
        .foregroundColor(secondary)
        .padding(.vertical, 9)
        .overlay(alignment: .bottom) {
            Rectangle().fill(text.opacity(0.12)).frame(height: 1)
        }
    }

    private func transcriptRow(_ row: OverlayRow) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                transcriptText(row.original)
                Rectangle()
                    .fill(text.opacity(0.12))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
                transcriptText(row.translation)
            }
            .background(text.opacity(0.02))
            Rectangle().fill(text.opacity(0.12)).frame(height: 1)
        }
        .id(row.id)
    }

    private func transcriptText(_ value: String) -> some View {
        Text(value.isEmpty ? "—" : value)
            .font(.system(size: 13))
            .foregroundColor(value.isEmpty ? secondary : text)
            .lineSpacing(3)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            // The padding belongs inside the flexible frame: with the frame
            // first, the HStack could squeeze the text narrower than its ideal
            // width while the window resized, and the selection layer clipped
            // the first glyph of every line.
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    // MARK: - Controls

    private var controlBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: "clock")
                    .font(.system(size: 10, weight: .medium))
                Text(formatElapsed(elapsed))
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
            }
            .foregroundColor(secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Capsule().fill(text.opacity(0.045)))
            Spacer()
            if model.notice != nil {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Done")
                        .font(.system(size: 11, weight: .semibold))
                }
                .foregroundColor(Color(red: 0.12, green: 0.62, blue: 0.36))
            } else {
                Button { model.sendCommand(model.paused ? "resume" : "pause") } label: {
                    Image(systemName: model.paused ? "play.fill" : "pause.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(accent)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(accent.opacity(model.live ? 0.13 : 0.06)))
                }
                .buttonStyle(.plain)
                .disabled(model.stopping || !model.live)
                .help(model.paused ? "Resume" : "Pause")
                Button { model.sendCommand("stop") } label: {
                    if model.stopping {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.55)
                            .frame(width: 30, height: 30)
                    } else {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(danger)
                            .frame(width: 30, height: 30)
                            .background(Circle().fill(danger.opacity(0.13)))
                    }
                }
                .buttonStyle(.plain)
                .disabled(model.stopping || !model.live)
                .help(model.stopping ? "Stopping" : "Stop")
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(text.opacity(0.018))
        .overlay(alignment: .top) {
            Rectangle().fill(text.opacity(0.07)).frame(height: 1)
        }
    }

    private var accent: Color {
        Color(red: 0.35, green: 0.43, blue: 0.93)
    }

    private var danger: Color {
        Color(red: 0.85, green: 0.26, blue: 0.24)
    }

    // MARK: - Gestures

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                let delta = CGSize(
                    width: value.translation.width - dragOrigin.width,
                    height: value.translation.height - dragOrigin.height
                )
                controller.move(by: delta)
                dragOrigin = value.translation
            }
            .onEnded { _ in dragOrigin = .zero }
    }

    private func toggleExpanded() {
        model.expanded.toggle()
        controller.setExpanded(model.expanded)
    }

    private func formatElapsed(_ value: TimeInterval) -> String {
        let total = Int(max(0, value))
        return String(format: "%02d:%02d", total / 60, total % 60)
    }
}

final class FloatingOverlayAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let model = OverlayModel()
    private let controller = OverlayWindowController()
    private var window: NSWindow?
    private var inputThread: Thread?
    private var signalSources: [DispatchSourceSignal] = []
    private var cancellables = Set<AnyCancellable>()
    private var isTerminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let state = loadWindowState()
        model.expanded = state.expanded
        model.display = OverlayDisplay(rawValue: state.display) ?? .both
        model.onCommand = { [weak self] detail, value in
            self?.emitControl(detail, value)
        }

        let size = state.expanded ? expandedWindowSize : compactWindowSize
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: size.width, height: size.height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Live Transcript"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isMovableByWindowBackground = false
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 320, height: 180)
        window.hasShadow = true
        window.delegate = self
        let hosting = NSHostingView(rootView: FloatingOverlayView(model: model, controller: controller))
        // The reader controls the window size, so the view must not resize it.
        hosting.sizingOptions = []
        window.contentView = hosting
        controller.window = window

        applyAppearance(model.appearance)
        model.$appearance
            .sink { [weak self] appearance in self?.applyAppearance(appearance) }
            .store(in: &cancellables)

        if let x = state.x, let y = state.y {
            window.setFrameOrigin(NSPoint(x: x, y: y))
        } else {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
        self.window = window

        NSApplication.shared.activate(ignoringOtherApps: true)
        installSignalHandlers()
        startReadingStandardInput()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        signalSources.forEach { $0.cancel() }
        saveWindowState()
    }

    func windowDidMove(_ notification: Notification) {
        saveWindowState()
    }

    func windowDidResize(_ notification: Notification) {
        saveWindowState()
    }

    // MARK: - Appearance

    private func applyAppearance(_ appearance: OverlayAppearance) {
        guard let window else { return }
        // A window that is meant to be solid has to be solid: an alpha of 0.999
        // still blends the desktop into the caption text.
        let opaque = appearance.opacity >= 0.999
        window.isOpaque = opaque
        window.backgroundColor = NSColor(appearance.backgroundColor)
            .withAlphaComponent(CGFloat(opaque ? 1 : appearance.opacity))
        window.appearance = NSAppearance(named: appearance.isLight ? .aqua : .darkAqua)
    }

    // MARK: - Window state

    private func stateURL() -> URL {
        if let override = ProcessInfo.processInfo.environment["AI_MINUTES_OVERLAY_STATE"], !override.isEmpty {
            return URL(fileURLWithPath: override)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".ai-minutes/overlay-window.json")
    }

    private func loadWindowState() -> OverlayWindowState {
        guard let raw = try? Data(contentsOf: stateURL()),
              let decoded = try? JSONDecoder().decode(OverlayWindowState.self, from: raw)
        else {
            return OverlayWindowState()
        }
        return decoded
    }

    private func saveWindowState() {
        guard let window else { return }
        var state = OverlayWindowState()
        state.x = window.frame.origin.x
        state.y = window.frame.origin.y
        state.width = window.frame.width
        state.height = window.frame.height
        state.expanded = model.expanded
        state.display = model.display.rawValue
        let url = stateURL()
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if let data = try? JSONEncoder().encode(state) {
            try? data.write(to: url)
        }
    }

    // MARK: - Commands

    /// Send a control event back to the plugin.
    private func emitControl(_ detail: String, _ value: String = "") {
        var payload: [String: Any] = ["type": "control", "detail": detail]
        if !value.isEmpty { payload["value"] = value }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8)
        else {
            return
        }
        FileHandle.standardOutput.write(Data((text + "\n").utf8))
    }

    // MARK: - Input

    private func startReadingStandardInput() {
        let thread = Thread { [weak self] in
            while let line = readLine(strippingNewline: true) {
                var shouldClose = false
                DispatchQueue.main.sync {
                    guard let self, !self.isTerminating else { return }
                    shouldClose = self.model.handle(line: line)
                }
                if shouldClose {
                    DispatchQueue.main.async { self?.requestTermination() }
                    return
                }
            }
            DispatchQueue.main.async { self?.requestTermination() }
        }
        thread.name = "floating-overlay-jsonl-stdin"
        thread.qualityOfService = .userInitiated
        inputThread = thread
        thread.start()
    }

    private func installSignalHandlers() {
        for number in [SIGINT, SIGTERM] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { [weak self] in
                self?.requestTermination()
            }
            source.resume()
            signalSources.append(source)
        }
    }

    private func requestTermination() {
        guard !isTerminating else { return }
        isTerminating = true
        NSApplication.shared.terminate(nil)
    }
}

@main
enum FloatingOverlayMain {
    static func main() {
        if CommandLine.arguments.contains("--self-test") {
            exit(FloatingOverlaySelfTest.run() ? 0 : 1)
        }

        let application = NSApplication.shared
        let delegate = FloatingOverlayAppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) {
            application.run()
        }
    }
}

enum FloatingOverlaySelfTest {
    static func run() -> Bool {
        var checkCount = 0
        var failures: [String] = []
        func expect(_ condition: @autoclosure () -> Bool, _ name: String) {
            checkCount += 1
            if !condition() {
                failures.append(name)
            }
        }

        do {
            let event = try OverlayParser.parse(
                #"{"seq":2,"type":"transcript","source":"mic","chunkId":1,"text":"Hello"}"#
            )
            if case let .transcript(id, text, _)? = event {
                expect(id == "chunk:mic:1", "transcript row id")
                expect(text == "Hello", "transcript text")
            } else {
                expect(false, "transcript event")
            }
        } catch {
            expect(false, "transcript parsing threw")
        }

        do {
            let event = try OverlayParser.parse(
                #"{"seq":3,"type":"translation","source":"mic","chunkId":1,"translation":"你好","text":"fallback","transcript":"Hello"}"#
            )
            if case let .translation(id, text, original)? = event {
                expect(id == "chunk:mic:1", "translation row id")
                expect(text == "你好", "translation field takes precedence")
                expect(original == "Hello", "translation original")
            } else {
                expect(false, "translation event")
            }
        } catch {
            expect(false, "translation parsing threw")
        }

        do {
            let fallback = try OverlayParser.parse(#"{"type":"translation","text":"Fallback"}"#)
            if case let .translation(_, text, _)? = fallback {
                expect(text == "Fallback", "translation text fallback")
            } else {
                expect(false, "translation fallback event")
            }
            let status = try OverlayParser.parse(#"{"type":"status","detail":"recording"}"#)
            if case let .status(detail)? = status {
                expect(detail == "recording", "status detail")
            } else {
                expect(false, "status event")
            }
            let error = try OverlayParser.parse(#"{"type":"error","detail":"capture failed"}"#)
            if case let .error(detail)? = error {
                expect(detail == "capture failed", "error detail")
            } else {
                expect(false, "error event")
            }
            let close = try OverlayParser.parse(#"{"type":"control","detail":"close"}"#)
            if case .close? = close {
                expect(true, "close control")
            } else {
                expect(false, "close control")
            }
            let ignored = try OverlayParser.parse(#"{"type":"audio","detail":"ignored"}"#)
            expect(ignored == nil, "unknown event ignored")
        } catch {
            expect(false, "representative event parsing threw")
        }

        do {
            let appearance = try OverlayParser.parse(
                ##"{"type":"appearance","background":"#102030","text":"#ffffff","opacity":0.8,"compact":false}"##
            )
            if case let .appearance(value)? = appearance {
                expect(value.background == "#102030", "appearance background")
                expect(value.text == "#ffffff", "appearance text")
                // 0.8 is under the legibility floor, so it is raised to it.
                expect(abs(value.opacity - minimumOverlayOpacity) < 0.0001, "appearance opacity floor")
                let solid = try OverlayParser.parse(
                    ##"{"type":"appearance","background":"#102030","text":"#ffffff","opacity":1}"##
                )
                if case let .appearance(solidValue)? = solid {
                    expect(abs(solidValue.opacity - 1) < 0.0001, "a solid window stays solid")
                }
                expect(value.compact == false, "appearance compact")
            } else {
                expect(false, "appearance event")
            }
        } catch {
            expect(false, "appearance parsing threw")
        }

        do {
            let session = try OverlayParser.parse(#"{"type":"session","startedAt":1700000000000}"#)
            if case let .session(startedAt)? = session {
                expect(startedAt != nil, "session start time")
            } else {
                expect(false, "session event")
            }
            let state = try OverlayParser.parse(#"{"type":"state","paused":true,"live":false,"stopping":true,"language":"en","languages":["zh","en"]}"#)
            if case let .state(paused, live, stopping, language, list)? = state {
                expect(paused == true, "state paused")
                expect(live == false, "state live")
                expect(stopping == true, "state stopping")
                expect(language == "en", "state language")
                expect(list == ["zh", "en"], "state languages")
            } else {
                expect(false, "state event")
            }
            let notice = try OverlayParser.parse(#"{"type":"notice","phase":"ready","text":"Minutes ready"}"#)
            if case let .notice(phase, text)? = notice {
                expect(phase == "ready", "notice phase")
                expect(text == "Minutes ready", "notice text")
            } else {
                expect(false, "notice event")
            }
        } catch {
            expect(false, "session parsing threw")
        }

        do {
            _ = try OverlayParser.parse("not-json")
            expect(false, "invalid JSON rejected")
        } catch {
            expect(true, "invalid JSON rejected")
        }
        do {
            _ = try OverlayParser.parse(#"["transcript"]"#)
            expect(false, "invalid root rejected")
        } catch {
            expect(true, "invalid root rejected")
        }

        expect(Color(hex: "#102030") != nil, "hex colour parses")
        expect(Color(hex: "not-a-colour") == nil, "bad hex colour rejected")

        let model = OverlayModel()
        expect(!model.handle(line: #"{"type":"transcript","source":"mic","chunkId":7,"text":"Original","level":0.5}"#), "transcript does not close")
        expect(!model.handle(line: #"{"type":"translation","source":"mic","chunkId":7,"translation":"Translated"}"#), "translation does not close")
        expect(model.rows.count == 1, "transcript and translation share a row")
        expect(model.rows.first?.original == "Original", "model original text")
        expect(model.rows.first?.translation == "Translated", "model translated text")
        expect(abs((model.rows.first?.level ?? 0) - 0.5) < 0.0001, "model level")
        expect(model.levels.isEmpty, "the waveform only follows the live signal")
        _ = model.handle(line: #"{"type":"level","level":0.4}"#)
        expect(model.levels.count == 1, "the live level feeds the waveform")
        expect(abs(model.levels[0] - 0.4) < 0.0001, "the waveform keeps the level")
        _ = model.handle(line: #"{"type":"status","detail":"recording"}"#)
        expect(model.status == "recording", "model status")
        _ = model.handle(line: #"{"type":"error","detail":"example error"}"#)
        expect(model.errorMessage == "example error", "model error")
        _ = model.handle(line: #"{"type":"session","startedAt":1700000000000}"#)
        expect(model.live == true, "model session is live")
        _ = model.handle(line: #"{"type":"state","paused":true,"live":true}"#)
        expect(model.paused == true, "model paused state")
        _ = model.handle(line: #"{"type":"state","live":true,"stopping":true}"#)
        expect(model.sessionEndedAt != nil, "stopping freezes the session clock")
        _ = model.handle(line: #"{"type":"notice","phase":"ready","text":"Minutes ready"}"#)
        expect(model.notice?.text == "Minutes ready", "the minutes ready notice reaches the model")
        expect(model.stopping == false, "the notice finishes the stopping state")
        _ = model.handle(line: #"{"type":"session","startedAt":1700000001000}"#)
        expect(model.sessionEndedAt == nil && model.notice == nil, "a new session resets the completion state")
        _ = model.handle(line: ##"{"type":"appearance","background":"#000000","text":"#ffffff","opacity":0.5,"compact":false}"##)
        expect(model.appearance.background == "#000000", "model appearance")
        expect(model.appearance.compact == false, "model compact default")
        expect(model.handle(line: #"{"type":"control","detail":"close"}"#), "model requests close")

        var received: [String] = []
        model.onCommand = { detail, value in received.append(detail + (value.isEmpty ? "" : ":" + value)) }
        model.sendCommand("pause")
        model.sendCommand("stop")
        model.sendCommand("language", "ja")
        expect(received == ["pause", "stop", "language:ja"], "commands reach the plugin")

        let displayModel = OverlayModel()
        _ = displayModel.handle(line: ##"{"type":"language","language":"en","languages":["zh","en"]}"##)
        expect(displayModel.translationLanguage == "en", "the translation language is known")
        expect(displayModel.languages == ["zh", "en"], "the available languages are known")
        displayModel.setDisplay(.translation)
        expect(displayModel.display == .translation, "the card can show only the translation")
        displayModel.setDisplay(.both)
        expect(displayModel.display == .both, "the card can show both")

        let malformedModel = OverlayModel()
        _ = malformedModel.handle(line: "not-json")
        expect(malformedModel.errorMessage?.contains("Invalid JSONL input") == true, "malformed input is displayed")

        let boundedModel = OverlayModel()
        for index in 0..<(maximumTranscriptRows + 10) {
            _ = boundedModel.handle(line: #"{"type":"transcript","chunkId":"# + String(index) + #","text":"row"}"#)
        }
        expect(boundedModel.rows.count == maximumTranscriptRows, "history is bounded")

        if failures.isEmpty {
            print("floating-overlay self-test: \(checkCount) checks passed")
            return true
        }

        for failure in failures {
            FileHandle.standardError.write(Data("floating-overlay self-test failed: \(failure)\n".utf8))
        }
        return false
    }
}
