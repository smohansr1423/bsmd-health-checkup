// Scaffolding placeholder build script for the Android client.
// Camera capture, TensorFlow Lite inference, the Health Connect bridge, and the
// biometric prompt are implemented in later tasks.
plugins {
    kotlin("jvm") version "1.9.24"
}

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}
