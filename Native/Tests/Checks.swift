import Foundation

@main enum Checks {
    static func main() async throws {
        let first = Post(id: "100", text: "First", publishedAt: "2026-09-29T10:00:00.000Z", url: "https://x.com/thsottiaux/status/100")
        let second = Post(id: "101", text: "Second", publishedAt: "2026-09-29T11:00:00.000Z", url: "https://x.com/thsottiaux/status/101")
        let baseline = TiboState.initial.applying(posts: [first], at: "2026-09-29T10:01:00.000Z")
        precondition(baseline.knownIds == ["100"] && baseline.unreadIds.isEmpty, "First fetch must establish a read baseline")
        let updated = baseline.applying(posts: [second, first], at: "2026-09-29T11:01:00.000Z")
        precondition(updated.unreadIds == ["101"], "Later first-seen post must be unread")
        precondition(updated.applying(posts: [second, first], at: "2026-09-29T11:02:00.000Z").unreadIds == ["101"], "Known post must not re-alert")
        precondition(updated.markingAllRead().unreadIds.isEmpty, "Mark all read must clear unread")

        let posts = (1...6).map { index in
            Post(id: "\(index)", text: "Post \(index)", publishedAt: String(format: "2026-09-29T%02d:00:00.000Z", index), url: nil)
        }
        let five = TiboState.initial.applying(posts: Array(posts.prefix(5)), at: "2026-09-29T10:00:00.000Z")
        precondition(five.applying(posts: posts, at: "2026-09-29T11:00:00.000Z").menuPosts.map(\.id) == ["6", "5", "4", "3", "2"], "Menu must show unread first then recent read posts")

        let failed = baseline.recordingFailure(kind: "network", at: "2026-09-29T11:00:00.000Z")
        precondition(failed.cachedPosts.map(\.id) == ["100"], "Failure must keep cached posts")
        precondition(failed.nextRetryAt == "2026-09-29T11:02:00.000Z", "First failure must back off two minutes")
        print("State checks passed")
        try storeChecks(baseline)
        try await feedChecks()
        try await presentationChecks()
    }

    static func storeChecks(_ legacyState: TiboState) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-check-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let legacy = root.appendingPathComponent("legacy.json")
        let native = root.appendingPathComponent("native")
        try JSONEncoder().encode(legacyState).write(to: legacy)
        let originalBytes = try Data(contentsOf: legacy)
        let store = StateStore(directory: native, legacyFile: legacy)
        let migrated = try store.loadOrMigrate()
        precondition(migrated.knownIds == ["100"] && migrated.unreadIds.isEmpty, "Migration must retain read history")
        let legacyBytes = try Data(contentsOf: legacy)
        precondition(legacyBytes == originalBytes, "Migration must not change legacy state")
        let stateFile = native.appendingPathComponent("state.json")
        let permissions = try FileManager.default.attributesOfItem(atPath: stateFile.path)[.posixPermissions] as? NSNumber
        precondition(permissions?.intValue == 0o600, "Native state must be private")
        try store.save(migrated.markingAllRead())
        let reloaded = try store.loadOrMigrate()
        precondition(reloaded.knownIds == ["100"], "Native state must survive reload")

        let bad = root.appendingPathComponent("invalid.json")
        try Data("{bad".utf8).write(to: bad)
        let invalidStore = StateStore(directory: root.appendingPathComponent("invalid-native"), legacyFile: bad)
        let recovered = try invalidStore.loadOrMigrate()
        precondition(recovered.recoveryPending, "Invalid legacy state must mark recovery pending")
        let badContents = try String(contentsOf: bad, encoding: .utf8)
        precondition(badContents == "{bad", "Invalid legacy file must be preserved")
        print("Store checks passed")
    }

    static func feedChecks() async throws {
        let client = FeedClient(request: { url in
            if url.query?.contains("cursor=next") == true {
                return try Self.response(url, ["code": 200, "results": [Self.post("2", 200), Self.post("1", 90)]])
            }
            return try Self.response(url, ["code": 200, "results": [Self.post("3", 300), Self.post("4", 250, "someone")], "cursor": ["bottom": "next"]])
        })
        let posts = try await client.fetch(since: "1970-01-01T00:01:40.000Z")
        precondition(posts.map(\.id) == ["3", "2", "1"], "Fetch must backfill and ignore other authors")
        precondition(posts[0].url == "https://x.com/thsottiaux/status/3", "Post URL must be canonical")

        let badURL = FeedClient(request: { url in
            var bad = Self.post("9", 900)
            bad["url"] = "https://evil.example/status/9"
            return try Self.response(url, ["code": 200, "results": [bad]])
        })
        do { _ = try await badURL.fetch(since: nil); preconditionFailure("Bad URL accepted") }
        catch { precondition((error as? FeedError)?.kind == "malformed", "Bad URL must be rejected") }

        let tooLarge = FeedClient(request: { url in
            (Data(repeating: 0, count: 2 * 1024 * 1024 + 1),
             HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        })
        do { _ = try await tooLarge.fetch(since: nil); preconditionFailure("Oversized page accepted") }
        catch { precondition((error as? FeedError)?.kind == "oversize", "Oversized page must be rejected") }

        let cycle = FeedClient(request: { url in
            try Self.response(url, ["code": 200, "results": [Self.post("9", 900)], "cursor": ["bottom": "next"]])
        })
        do { _ = try await cycle.fetch(since: "1970-01-01T00:01:40.000Z"); preconditionFailure("Cursor cycle accepted") }
        catch { precondition((error as? FeedError)?.kind == "malformed", "Cursor cycle must be bounded") }

        let slow = FeedClient(timeout: 0.01, request: { url in
            try await Task.sleep(nanoseconds: 200_000_000)
            return try Self.response(url, ["code": 200, "results": [Self.post("1", 1)]])
        })
        do { _ = try await slow.fetch(since: nil); preconditionFailure("Slow request accepted") }
        catch { precondition((error as? FeedError)?.kind == "timeout", "Whole fetch must have one deadline") }

        let fourBytes = AsyncStream<UInt8> { stream in
            for value: UInt8 in [1, 2, 3, 4] { stream.yield(value) }
            stream.finish()
        }
        do { _ = try await FeedClient.readBounded(fourBytes, maxBytes: 3); preconditionFailure("Streaming size cap missed") }
        catch { precondition((error as? FeedError)?.kind == "oversize", "Stream must stop at size cap") }

        let booleanTime = FeedClient(request: { url in
            try Self.response(url, ["code": 200, "results": [["type": "status", "id": "8", "text": "bad",
                "created_timestamp": true, "url": "https://x.com/thsottiaux/status/8",
                "author": ["screen_name": "thsottiaux"]]]])
        })
        do { _ = try await booleanTime.fetch(since: nil); preconditionFailure("Boolean timestamp accepted") }
        catch { precondition((error as? FeedError)?.kind == "malformed", "Boolean timestamp must be rejected") }

        let hugeTime = FeedClient(request: { url in
            try Self.response(url, ["code": 200, "results": [["type": "status", "id": "8", "text": "bad",
                "created_timestamp": 1e100, "url": "https://x.com/thsottiaux/status/8",
                "author": ["screen_name": "thsottiaux"]]]])
        })
        do { _ = try await hugeTime.fetch(since: nil); preconditionFailure("Extreme timestamp accepted") }
        catch { precondition((error as? FeedError)?.kind == "malformed", "Extreme timestamp must be rejected") }
        print("Feed checks passed")
    }

    static func response(_ url: URL, _ value: [String: Any]) throws -> (Data, HTTPURLResponse) {
        let data = try JSONSerialization.data(withJSONObject: value)
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }

    static func post(_ id: String, _ time: Int, _ author: String = "thsottiaux") -> [String: Any] {
        ["type": "status", "id": id, "text": "post \(id)", "created_timestamp": time,
         "url": "https://x.com/\(author)/status/\(id)", "author": ["screen_name": author]]
    }

    @MainActor static func presentationChecks() async throws {
        let old = Post(id: "100", text: "old", publishedAt: "2026-09-29T10:00:00.000Z", url: nil)
        let unread = Post(id: "101", text: "new", publishedAt: "2026-09-29T11:00:00.000Z", url: nil)
        let state = TiboState.initial.applying(posts: [old], at: "2026-09-29T10:01:00.000Z")
            .applying(posts: [unread, old], at: "2026-09-29T11:01:00.000Z")
            .recordingFailure(kind: "network", at: "2026-09-29T11:02:00.000Z")
            .recordingFailure(kind: "network", at: "2026-09-29T11:04:00.000Z")
            .recordingFailure(kind: "network", at: "2026-09-29T11:08:00.000Z")
        precondition(AppModel.iconState(for: state) == "unread", "Unread icon must outrank offline")
        precondition(AppModel.iconState(for: state.markingAllRead()) == "offline", "Three failures must show offline")
        precondition(AppModel.iconAssetName(for: state, darkAppearance: false) == "unread-light", "Light appearance must use the light asset")
        precondition(AppModel.iconAssetName(for: state, darkAppearance: true) == "unread-dark", "Dark appearance must use the dark asset")
        precondition(AppModel.preview("hello | bash=rm\nline") == ["hello | bash=rm", "line"], "Remote text must remain literal")
        precondition(AppModel.status(for: state).contains("offline"), "Status must explain cached offline data")

        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tibo-model-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = StateStore(directory: root, legacyFile: root.appendingPathComponent("missing"))
        try store.save(state)
        let gate = FetchGate()
        let feed = FeedClient(request: { url in
            await gate.wait()
            return try Self.response(url, ["code": 200, "results": [Self.post("102", 1_780_000_000)]])
        })
        let model = AppModel(store: store, feed: feed)
        let refresh = Task { await model.refresh(force: true) }
        await gate.untilStarted()
        model.markAllRead()
        await gate.release()
        await refresh.value
        precondition(model.state.unreadIds == ["102"], "In-flight poll must keep new post unread without reviving read IDs")
        print("Presentation checks passed")
    }
}

actor FetchGate {
    private var begun = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var finishWaiter: CheckedContinuation<Void, Never>?

    func wait() async {
        begun = true
        startWaiter?.resume()
        startWaiter = nil
        await withCheckedContinuation { finishWaiter = $0 }
    }

    func untilStarted() async {
        if begun { return }
        await withCheckedContinuation { startWaiter = $0 }
    }

    func release() {
        finishWaiter?.resume()
        finishWaiter = nil
    }
}
