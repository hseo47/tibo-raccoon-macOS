import Darwin
import Foundation

public struct StateStore: Sendable {
    public let directory: URL
    public let legacyFile: URL

    public init(directory: URL? = nil, legacyFile: URL? = nil) {
        let support = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        self.directory = directory ?? support.appendingPathComponent("Tibo Raccoon App", isDirectory: true)
        self.legacyFile = legacyFile ?? support.appendingPathComponent("Tibo Raccoon/state.json")
    }

    public func loadOrMigrate() throws -> TiboState {
        let stateFile = directory.appendingPathComponent("state.json")
        if FileManager.default.fileExists(atPath: stateFile.path) {
            do { return try read(stateFile) }
            catch {
                let backup = directory.appendingPathComponent("state.json.corrupt-\(Int(Date().timeIntervalSince1970))")
                try FileManager.default.moveItem(at: stateFile, to: backup)
                var recovered = TiboState.initial
                recovered.recoveryPending = true
                try save(recovered)
                return recovered
            }
        }
        if FileManager.default.fileExists(atPath: legacyFile.path) {
            let migrated: TiboState
            do { migrated = try read(legacyFile) }
            catch {
                var recovered = TiboState.initial
                recovered.recoveryPending = true
                try save(recovered)
                return recovered
            }
            try save(migrated)
            return migrated
        }
        return .initial
    }

    public func save(_ state: TiboState) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let target = directory.appendingPathComponent("state.json")
        let temp = directory.appendingPathComponent("state.json.tmp-\(UUID().uuidString)")
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(state)
        guard FileManager.default.createFile(atPath: temp.path, contents: nil,
                                             attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        do {
            let handle = try FileHandle(forWritingTo: temp)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
            guard rename(temp.path, target.path) == 0 else {
                throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
            }
        } catch {
            try? FileManager.default.removeItem(at: temp)
            throw error
        }
    }

    private func read(_ file: URL) throws -> TiboState {
        let state = try JSONDecoder().decode(TiboState.self, from: Data(contentsOf: file))
        let known = Set(state.knownIds)
        let cached = Set(state.cachedPosts.map(\.id))
        guard state.version == 1, state.consecutiveFailures >= 0,
              state.knownIds.allSatisfy({ !$0.isEmpty }),
              state.unreadIds.allSatisfy({ known.contains($0) && cached.contains($0) }),
              state.cachedPosts.allSatisfy({ known.contains($0.id) && Self.validPost($0) }),
              [state.initializedAt, state.lastAttemptAt, state.lastSuccessAt, state.nextRetryAt]
                .allSatisfy({ $0 == nil || TiboState.date($0) != nil }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        return state
    }

    private static func validPost(_ post: Post) -> Bool {
        guard !post.id.isEmpty, post.publishedAt == nil || TiboState.date(post.publishedAt) != nil else { return false }
        guard let link = post.url else { return true }
        guard let parts = URLComponents(string: link), parts.scheme == "https",
              ["x.com", "www.x.com", "twitter.com", "www.twitter.com"].contains(parts.host ?? ""),
              parts.user == nil, parts.password == nil, parts.port == nil else { return false }
        return true
    }
}
