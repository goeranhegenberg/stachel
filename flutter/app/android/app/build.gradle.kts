import java.io.File
import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Upload-Schlüssel der Stachel-App: android/key.properties (gitignored) oder, wenn es die nicht gibt,
// ~/secrets/stachel/key.properties (Görans Rechner). Ohne Schlüssel baut release nur mit Debug-Signatur.
val keystoreProperties = Properties().apply {
    val local = rootProject.file("key.properties")
    val home = File(System.getProperty("user.home"), "secrets/stachel/key.properties")
    val f = if (local.exists()) local else home
    if (f.exists()) load(FileInputStream(f))
}
val hasUploadKey = keystoreProperties.getProperty("storeFile") != null

android {
    namespace = "com.intsode.stachel"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.intsode.stachel"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasUploadKey) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasUploadKey) "release" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
