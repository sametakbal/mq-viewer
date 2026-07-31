package org.akbal.i18n;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.MessageFormat;
import java.util.Locale;
import java.util.ResourceBundle;

/**
 * Singleton that manages the active locale and provides localised messages
 * via {@link ResourceBundle}. The user's preference is persisted to
 * {@code ~/.mq-viewer/locale.txt}.
 */
public final class LocaleManager {

    private static final String STORE_DIR = System.getProperty("user.home")
            + java.io.File.separator + ".mq-viewer";
    private static final String LOCALE_FILE = STORE_DIR + java.io.File.separator + "locale.txt";
    private static final String BUNDLE_BASE = "messages";

    private static final LocaleManager INSTANCE = new LocaleManager();

    private Locale currentLocale;
    private ResourceBundle bundle;

    private LocaleManager() {
        currentLocale = loadSavedLocale();
        reloadBundle();
    }

    public static LocaleManager getInstance() {
        return INSTANCE;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** Returns the active locale. */
    public Locale getLocale() {
        return currentLocale;
    }

    /** Switches locale, persists it, and reloads the bundle. */
    public void setLocale(Locale locale) {
        this.currentLocale = locale;
        saveLocale(locale);
        reloadBundle();
    }

    /** Looks up a simple message by key. */
    public String get(String key) {
        try {
            return bundle.getString(key);
        } catch (java.util.MissingResourceException e) {
            return "!" + key + "!";
        }
    }

    /** Looks up a message with {@link MessageFormat} placeholders. */
    public String get(String key, Object... args) {
        String pattern = get(key);
        try {
            return MessageFormat.format(pattern, args);
        } catch (IllegalArgumentException e) {
            return pattern;
        }
    }

    /** Convenience: shorthand static access. */
    public static String msg(String key) {
        return INSTANCE.get(key);
    }

    /** Convenience: shorthand static access with args. */
    public static String msg(String key, Object... args) {
        return INSTANCE.get(key, args);
    }

    // ── Internal ────────────────────────────────────────────────────────────

    private void reloadBundle() {
        // Clear the ResourceBundle cache so a new locale takes effect
        ResourceBundle.clearCache();
        bundle = ResourceBundle.getBundle(BUNDLE_BASE, currentLocale);
    }

    private Locale loadSavedLocale() {
        Path path = Path.of(LOCALE_FILE);
        if (Files.exists(path)) {
            try {
                String tag = Files.readString(path, StandardCharsets.UTF_8).trim();
                if (!tag.isEmpty()) {
                    return Locale.forLanguageTag(tag);
                }
            } catch (IOException ignored) {
            }
        }
        // Default to Turkish
        return Locale.of("tr");
    }

    private void saveLocale(Locale locale) {
        try {
            Files.createDirectories(Path.of(STORE_DIR));
            Files.writeString(Path.of(LOCALE_FILE), locale.toLanguageTag(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
