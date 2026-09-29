import CoreFoundation
import Foundation

public struct FeedError: Error, Sendable {
    public let kind: String
    public let status: Int?

    public init(_ kind: String, status: Int? = nil) {
        self.kind = kind
        self.status = status
    }
}

public struct FeedClient: Sendable {
    public typealias PageRequest = @Sendable (URL) async throws -> (Data, HTTPURLResponse)
    private let request: PageRequest
    private let timeout: TimeInterval

    public init() {
        self.request = { url in try await Self.liveRequest(url) }
        self.timeout = 25
    }

    public init(timeout: TimeInterval = 25, request: @escaping PageRequest) {
        self.request = request
        self.timeout = timeout
    }

    public func fetch(since: String?) async throws -> [Post] {
        let oldestKnown = since.flatMap(TiboState.date)
        if since != nil && oldestKnown == nil { throw FeedError("malformed") }
        var posts: [Post] = []
        var cursor: String? = nil
        var seenCursors = Set<String>()
        let deadline = Date().addingTimeInterval(timeout)
        for page in 0..<20 {
            if Date() >= deadline { throw FeedError("timeout") }
            var parts = URLComponents(string: "https://api.fxtwitter.com/2/profile/thsottiaux/statuses")!
            parts.queryItems = [URLQueryItem(name: "count", value: "100"), URLQueryItem(name: "with_replies", value: "1")]
            if let cursor { parts.queryItems!.append(URLQueryItem(name: "cursor", value: cursor)) }
            let url = parts.url!
            let data: Data
            let response: HTTPURLResponse
            do { (data, response) = try await timedRequest(url, deadline: deadline) }
            catch let error as FeedError { throw error }
            catch let error as URLError where error.code == .timedOut { throw FeedError("timeout") }
            catch { throw FeedError(Date() >= deadline ? "timeout" : "network") }
            guard response.statusCode == 200 else { throw FeedError("http", status: response.statusCode) }
            if let length = response.value(forHTTPHeaderField: "Content-Length"),
               let count = Int(length), count > 2 * 1024 * 1024 { throw FeedError("oversize") }
            guard data.count <= 2 * 1024 * 1024 else { throw FeedError("oversize") }
            let parsed = try Self.parsePage(data)
            if page == 0 && parsed.posts.isEmpty { throw FeedError("malformed") }
            posts.append(contentsOf: parsed.posts)
            if posts.count > 500 { throw FeedError("malformed") }
            if oldestKnown == nil || parsed.posts.contains(where: { (TiboState.date($0.publishedAt) ?? .distantFuture) < oldestKnown! }) || parsed.cursor == nil {
                var ids = Set<String>()
                return posts.filter { ids.insert($0.id).inserted }.sorted {
                    if $0.publishedAt != $1.publishedAt { return ($0.publishedAt ?? "") > ($1.publishedAt ?? "") }
                    return $0.id > $1.id
                }
            }
            guard let next = parsed.cursor, seenCursors.insert(next).inserted else { throw FeedError("malformed") }
            cursor = next
        }
        throw FeedError("malformed")
    }

    private func timedRequest(_ url: URL, deadline: Date) async throws -> (Data, HTTPURLResponse) {
        let remaining = deadline.timeIntervalSinceNow
        if remaining <= 0 { throw FeedError("timeout") }
        return try await withThrowingTaskGroup(of: (Data, HTTPURLResponse).self) { group in
            group.addTask { try await request(url) }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000_000))
                throw FeedError("timeout")
            }
            defer { group.cancelAll() }
            guard let first = try await group.next() else { throw FeedError("network") }
            return first
        }
    }

    private static func parsePage(_ data: Data) throws -> (posts: [Post], cursor: String?) {
        guard let page = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = page["code"] as? Int, code == 200,
              let results = page["results"] as? [Any], results.count <= 100 else { throw FeedError("malformed") }
        var posts: [Post] = []
        for item in results {
            guard let item = item as? [String: Any], let type = item["type"] as? String else { throw FeedError("malformed") }
            if type != "status" { continue }
            guard let author = item["author"] as? [String: Any], let screenName = author["screen_name"] as? String else { throw FeedError("malformed") }
            if screenName != "thsottiaux" { continue }
            guard let id = item["id"] as? String, !id.isEmpty,
                  id.unicodeScalars.allSatisfy({ (48...57).contains($0.value) }),
                  let text = item["text"] as? String, text.unicodeScalars.count <= 32_768,
                  let timestampNumber = item["created_timestamp"] as? NSNumber,
                  CFGetTypeID(timestampNumber) != CFBooleanGetTypeID(),
                  let url = item["url"] as? String,
                  url == "https://x.com/thsottiaux/status/\(id)" else { throw FeedError("malformed") }
            let seconds = timestampNumber.doubleValue
            guard seconds.isFinite, seconds > 0, seconds <= Date().timeIntervalSince1970 + 86_400,
                  seconds.rounded(.towardZero) == seconds else { throw FeedError("malformed") }
            let publishedAt = TiboState.timestamp(from: Date(timeIntervalSince1970: seconds))
            guard TiboState.date(publishedAt) != nil else { throw FeedError("malformed") }
            posts.append(Post(id: id, text: text, publishedAt: publishedAt, url: url))
        }
        var cursor: String? = nil
        if let raw = page["cursor"] as? [String: Any], let bottom = raw["bottom"] {
            guard let value = bottom as? String, value.count <= 512 else { throw FeedError("malformed") }
            if !value.isEmpty { cursor = value }
        }
        return (posts, cursor)
    }

    private static func liveRequest(_ url: URL) async throws -> (Data, HTTPURLResponse) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 25
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw FeedError("malformed") }
        if let length = response.value(forHTTPHeaderField: "Content-Length"),
           let count = Int(length), count > 2 * 1024 * 1024 { throw FeedError("oversize") }
        let data = try await readBounded(bytes, maxBytes: 2 * 1024 * 1024)
        return (data, response)
    }

    static func readBounded<S: AsyncSequence>(_ bytes: S, maxBytes: Int) async throws -> Data where S.Element == UInt8 {
        var data = Data()
        for try await byte in bytes {
            if data.count >= maxBytes { throw FeedError("oversize") }
            data.append(byte)
        }
        return data
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
