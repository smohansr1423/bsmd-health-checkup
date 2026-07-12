// swift-tools-version:5.9
import PackageDescription

// Scaffolding placeholder for the iOS App (Swift/SwiftUI · Core ML · HealthKit ·
// AVFoundation). Camera capture, on-device inference, HealthKit bridge, and the
// biometric gate are implemented in later tasks.
let package = Package(
    name: "CalorieCortisol",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "CalorieCortisol", targets: ["CalorieCortisol"])
    ],
    targets: [
        .target(name: "CalorieCortisol", path: "Sources/CalorieCortisol"),
        .testTarget(
            name: "CalorieCortisolTests",
            dependencies: ["CalorieCortisol"],
            path: "Tests/CalorieCortisolTests"
        )
    ]
)
