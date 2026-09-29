import Combine
import Foundation

@MainActor public final class AppModel: ObservableObject {
    @Published public private(set) var state: TiboState
    @Published public private(set) var notice: String? = nil
    @Published public private(set) var isRefreshing = false

    private let store: StateStore
    private let feed: FeedClient

    public init(store: StateStore = StateStore(), feed: FeedClient = FeedClient()) {
        self.store = store
        self.feed = feed
        do { self.state = try store.loadOrMigrate() }
        catch {
            var recovered = TiboState.initial
            recovered.recoveryPending = true
            self.state = recovered
            self.notice = "Local state unavailable"
        }
    }

    public func run() async {
        await refresh(force: false)
        while !Task.isCancelled {
            do { try await Task.sleep(nanoseconds: 120_000_000_000) }
            catch { break }
            await refresh(force: false)
        }
    }

    public func refresh(force: Bool) async {
        guard !isRefreshing else { return }
        let now = Date()
        if !force {
            if let last = TiboState.date(state.lastAttemptAt), now.timeIntervalSince(last) < 30 { return }
            if let retry = TiboState.date(state.nextRetryAt), now < retry { return }
        }
        isRefreshing = true
        defer { isRefreshing = false }
        let newest = state.cachedPosts.compactMap(\.publishedAt).max()
        let next: TiboState
        do {
            let posts = try await feed.fetch(since: newest)
            next = state.applying(posts: posts, at: TiboState.timestamp(from: Date()))
        } catch {
            next = state.recordingFailure(kind: (error as? FeedError)?.kind ?? "network",
                                          at: TiboState.timestamp(from: Date()))
        }
        do {
            try store.save(next)
            state = next
            notice = nil
        } catch {
            notice = "Local state unavailable"
        }
    }

    public func markAllRead() {
        let next = state.markingAllRead()
        do {
            try store.save(next)
            state = next
            notice = nil
        } catch {
            notice = "Local state unavailable"
        }
    }

    public static func iconState(for state: TiboState) -> String {
        if !state.unreadIds.isEmpty { return "unread" }
        if state.consecutiveFailures >= 3 { return "offline" }
        return "calm"
    }

    public static func iconAssetName(for state: TiboState, darkAppearance: Bool) -> String {
        "\(iconState(for: state))-\(darkAppearance ? "dark" : "light")"
    }

    public static func status(for state: TiboState) -> String {
        if state.consecutiveFailures >= 3 { return "Feed offline · showing cached posts" }
        if state.consecutiveFailures > 0 { return "Feed unavailable · showing cached posts" }
        guard let last = TiboState.date(state.lastSuccessAt) else { return "Waiting for first successful refresh" }
        return "Updated \(dateLabel(last))"
    }

    public static func dateLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMM d, h:mm a")
        return formatter.string(from: date)
    }

    public static func preview(_ text: String) -> [String] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\u{2028}", with: "\n")
            .replacingOccurrences(of: "\u{2029}", with: "\n")
        var rows: [String] = []
        for line in normalized.components(separatedBy: "\n") {
            let cleaned = String(String.UnicodeScalarView(line.unicodeScalars.map { scalar in
                scalar.value == 9 ? " ".unicodeScalars.first! : scalar
            }.filter { $0.value >= 32 && $0.value != 127 }))
            let scalars = Array(cleaned.unicodeScalars)
            for start in stride(from: 0, to: scalars.count, by: 54) {
                let row = scalars[start..<min(start + 54, scalars.count)].map(String.init).joined()
                    .trimmingCharacters(in: .whitespaces)
                if !row.isEmpty { rows.append(row) }
            }
        }
        if rows.isEmpty { return ["New media post from Tibo"] }
        if rows.count <= 3 { return rows }
        var shown = Array(rows.prefix(3))
        let final = Array(shown[2].unicodeScalars)
        shown[2] = final.prefix(53).map(String.init).joined() + "…"
        return shown
    }
}
