// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TiboRaccoon",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "TiboCore", targets: ["TiboCore"]),
        .executable(name: "TiboApp", targets: ["TiboApp"]),
    ],
    targets: [
        .target(name: "TiboCore"),
        .executableTarget(name: "TiboApp", dependencies: ["TiboCore"]),
    ]
)
