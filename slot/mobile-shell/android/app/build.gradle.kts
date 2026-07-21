plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun String.toBuildConfigString(): String = "\"" + replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val casinoServerBase: String = providers.gradleProperty("casinoServerBase")
    .orElse(providers.environmentVariable("CASINO_SERVER_BASE"))
    .orElse("https://casino.retailerway.com")
    .get()

val clientRenderSecret: String = providers.gradleProperty("clientRenderSecret")
    .orElse(providers.environmentVariable("CLIENT_RENDER_SECRET"))
    .orElse("")
    .get()

android {
    namespace = "com.retailerway.casino"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.retailerway.casino"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "CASINO_SERVER_BASE", casinoServerBase.toBuildConfigString())
        buildConfigField("String", "CLIENT_RENDER_SECRET", clientRenderSecret.toBuildConfigString())
    }

    buildFeatures {
        buildConfig = true
    }
}
