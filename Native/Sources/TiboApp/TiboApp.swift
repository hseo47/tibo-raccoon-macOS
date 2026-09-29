import AppKit
import SwiftUI
import TiboCore

@main struct TiboApp: App {
    @StateObject private var model: AppModel

    init() {
        let model = AppModel()
        _model = StateObject(wrappedValue: model)
        Task { await model.run() }
    }

    var body: some Scene {
        MenuBarExtra {
            TiboPanel(model: model)
        } label: {
            TiboIcon(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}

private struct TiboIcon: View {
    @ObservedObject var model: AppModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let name = AppModel.iconAssetName(for: model.state, darkAppearance: colorScheme == .dark)
        let image = NSImage(contentsOfFile: Bundle.main.path(forResource: name, ofType: "png") ?? "") ?? NSImage()
        image.size = NSSize(width: 23, height: 17)
        image.isTemplate = false
        return Image(nsImage: image).accessibilityLabel("Tibo Raccoon, \(model.state.unreadIds.count) unread")
    }
}

private struct TiboPanel: View {
    @ObservedObject var model: AppModel
    private let profile = URL(string: "https://x.com/thsottiaux")!

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Tibo Raccoon")
                    .font(.system(size: 14, weight: .semibold))
                Spacer()
                Text("\(model.state.unreadIds.count) unread")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 10)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(model.state.menuPosts.enumerated()), id: \.element.id) { index, post in
                        if index > 0 { Divider().padding(.vertical, 10) }
                        postGroup(post)
                    }
                    if model.state.menuPosts.isEmpty {
                        Text("No posts yet")
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 18)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 10)
            }
            .frame(maxHeight: 520)
            Divider()
            HStack(spacing: 14) {
                Button("Mark all as read") { model.markAllRead() }
                    .disabled(model.state.unreadIds.isEmpty)
                Button("Refresh now") { Task { await model.refresh(force: true) } }
                    .disabled(model.isRefreshing)
                Spacer()
                Button("Quit") { NSApplication.shared.terminate(nil) }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .medium))
            .padding(.top, 10)
            Button("Open Tibo’s profile ↗") { NSWorkspace.shared.open(profile) }
                .buttonStyle(.plain)
                .font(.system(size: 12))
                .padding(.top, 9)
            Text(model.notice ?? AppModel.status(for: model.state))
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(.top, 9)
        }
        .padding(12)
        .frame(width: 370)
    }

    @ViewBuilder private func postGroup(_ post: Post) -> some View {
        let unread = model.state.unreadIds.contains(post.id)
        let date = TiboState.date(post.publishedAt).map(AppModel.dateLabel) ?? "Time unavailable"
        HStack(spacing: 5) {
            if let link = post.url, let url = URL(string: link) {
                Button("Tibo · \(date) ↗") { NSWorkspace.shared.open(url) }
                    .buttonStyle(.plain)
            } else {
                Text("Tibo · \(date)")
            }
            if unread {
                Text("NEW")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Color(red: 0.8, green: 0.32, blue: 0.29))
            }
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(unread ? .primary : .secondary)
        .padding(.bottom, 6)
        ForEach(Array(AppModel.preview(post.text).enumerated()), id: \.offset) { _, row in
            Text(row)
                .font(.system(size: 13))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 2)
        }
        if post.url == nil {
            Text("Full post link unavailable")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
        }
    }
}
