import Foundation

public struct Post: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let text: String
    public let publishedAt: String?
    public let url: String?

    public init(id: String, text: String, publishedAt: String?, url: String?) {
        self.id = id
        self.text = text
        self.publishedAt = publishedAt
        self.url = url
    }
}

public struct TiboState: Codable, Sendable {
    public var version = 1
    public var initializedAt: String? = nil
    public var recoveryPending = false
    public var knownIds: [String] = []
    public var unreadIds: [String] = []
    public var cachedPosts: [Post] = []
    public var lastAttemptAt: String? = nil
    public var lastSuccessAt: String? = nil
    public var consecutiveFailures = 0
    public var nextRetryAt: String? = nil
    public var lastError: String? = nil

    public static let initial = TiboState()

    public var menuPosts: [Post] {
        let unread = Set(unreadIds)
        let ordered = cachedPosts.sorted(by: Self.newer)
        let new = ordered.filter { unread.contains($0.id) }
        let read = ordered.filter { !unread.contains($0.id) }
        return new + read.prefix(max(0, 5 - new.count))
    }

    public func applying(posts: [Post], at now: String) -> TiboState {
        var result = self
        let incoming = Self.unique(posts)
        let wasKnown = Set(knownIds)
        let first = initializedAt == nil
        var unread = Set(unreadIds)
        for post in incoming where recoveryPending || (!first && !wasKnown.contains(post.id)) {
            unread.insert(post.id)
        }
        result.knownIds = Array(wasKnown.union(incoming.map(\.id))).sorted()
        let cached = Self.unique(incoming + cachedPosts).sorted(by: Self.newer)
        result.cachedPosts = cached.filter { unread.contains($0.id) } + cached.filter { !unread.contains($0.id) }.prefix(100)
        result.cachedPosts.sort(by: Self.newer)
        result.unreadIds = result.cachedPosts.filter { unread.contains($0.id) }.map(\.id)
        result.initializedAt = initializedAt ?? now
        result.recoveryPending = false
        result.lastAttemptAt = now
        result.lastSuccessAt = now
        result.consecutiveFailures = 0
        result.nextRetryAt = nil
        result.lastError = nil
        return result
    }

    public func markingAllRead() -> TiboState {
        var result = self
        result.unreadIds = []
        return result
    }

    public func recordingFailure(kind: String, at now: String) -> TiboState {
        var result = self
        result.consecutiveFailures += 1
        let minutes = [2, 4, 8, 16, 30][min(result.consecutiveFailures - 1, 4)]
        result.lastAttemptAt = now
        result.nextRetryAt = Self.timestamp(from: (Self.date(now) ?? Date()).addingTimeInterval(Double(minutes * 60)))
        result.lastError = kind
        return result
    }

    public static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    public static func timestamp(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func unique(_ posts: [Post]) -> [Post] {
        var seen = Set<String>()
        return posts.filter { seen.insert($0.id).inserted }
    }

    private static func newer(_ left: Post, _ right: Post) -> Bool {
        if left.publishedAt == nil { return false }
        if right.publishedAt == nil { return true }
        if left.publishedAt != right.publishedAt { return left.publishedAt! > right.publishedAt! }
        return left.id > right.id
    }
}
