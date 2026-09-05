/**
 * Internationalization helper for Chrome Extension
 * Automatically localizes HTML elements with data-i18n attributes
 */

// Store current locale and messages
let currentLocale = null;
let currentMessages = null;

/**
 * Get localized message from chrome.i18n or custom locale
 * @param {string} messageName - Message key from messages.json
 * @param {string[]} substitutions - Optional substitution strings
 * @returns {string} Localized message
 */
function i18n(messageName, substitutions) {
  // If custom locale is set, use it
  if (currentMessages && currentMessages[messageName]) {
    return applySubstitutions(currentMessages[messageName].message, substitutions);
  }

  // Otherwise, use chrome.i18n
  return chrome.i18n.getMessage(messageName, substitutions);
}

function applySubstitutions(message, substitutions) {
  if (!message || !substitutions) return message;
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  return values.reduce((result, value, index) => {
    const token = new RegExp(`\\$${index + 1}`, 'g');
    return result.replace(token, value);
  }, message);
}

/**
 * Load messages from a specific locale
 * @param {string} locale - Locale code (e.g., 'en', 'de', 'fr')
 * @returns {Promise<object>} Messages object
 */
async function loadLocale(locale) {
  try {
    const response = await fetch(`/_locales/${locale}/messages.json`);
    const messages = await response.json();
    currentLocale = locale;
    currentMessages = messages;
    return messages;
  } catch (error) {
    console.error(`Failed to load locale ${locale}:`, error);
    // Fallback to chrome.i18n
    currentMessages = null;
    return null;
  }
}

/**
 * Get current locale from settings or browser
 * @returns {Promise<string>} Current locale code
 */
async function getCurrentLocale() {
  // Try to get from storage first
  if (typeof StorageManager !== 'undefined') {
    try {
      const settings = await StorageManager.getSettings();
      if (settings.language) {
        return settings.language;
      }
    } catch (error) {
      console.error('Failed to get language from settings:', error);
    }
  }

  // Fallback to browser language
  const browserLocale = chrome.i18n.getUILanguage();
  const normalized = browserLocale.replace('_', '-').toLowerCase();

  // Map browser locales to supported locales
  if (normalized.startsWith('pt-pt')) return 'pt_PT';
  if (normalized.startsWith('pt')) return 'pt_BR';
  if (normalized.startsWith('zh-hant') || normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) return 'zh_TW';
  if (normalized.startsWith('zh')) return 'zh_CN';
  if (normalized.startsWith('fil') || normalized.startsWith('tl')) return 'fil';
  if (normalized.startsWith('id') || normalized.startsWith('in')) return 'id';
  if (normalized.startsWith('he') || normalized.startsWith('iw')) return 'he';
  if (normalized.startsWith('nb') || normalized.startsWith('no')) return 'nb';

  const baseLang = normalized.split('-')[0];
  const directLocales = new Set([
    'de', 'fr', 'es', 'it', 'ja', 'ru', 'ko', 'ar', 'hi', 'tr',
    'nl', 'pl', 'vi', 'th', 'fa', 'uk', 'cs', 'ro', 'hu', 'sv',
    'da', 'fi', 'el', 'ms', 'bn', 'ur', 'ta', 'te', 'mr', 'gu',
    'pa', 'kn', 'ml', 'bg', 'sk', 'hr', 'sr', 'sl', 'az', 'uz', 'sw'
  ]);
  if (directLocales.has(baseLang)) return baseLang;
  return 'en'; // Default to English
}

/**
 * Localize all elements with data-i18n attribute
 * Usage in HTML: <button data-i18n="buttonText">Default Text</button>
 * Or for placeholders: <input data-i18n-placeholder="inputPlaceholder">
 * Or for title/tooltip: <button data-i18n-title="tooltipText">Button</button>
 */
function localizeHtmlPage() {
  // Localize text content
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const messageName = element.getAttribute('data-i18n');
    const message = i18n(messageName);
    if (message) {
      element.textContent = message;
    }
  });

  // Localize placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const messageName = element.getAttribute('data-i18n-placeholder');
    const message = i18n(messageName);
    if (message) {
      element.placeholder = message;
    }
  });

  // Localize titles/tooltips
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const messageName = element.getAttribute('data-i18n-title');
    const message = i18n(messageName);
    if (message) {
      element.title = message;
    }
  });
}

/**
 * Initialize i18n with saved or browser locale
 */
async function initializeI18n() {
  const locale = await getCurrentLocale();
  await loadLocale(locale);
  setDocumentLocale(locale);
  localizeHtmlPage();
}

function setDocumentLocale(locale) {
  const rtlLocales = new Set(['ar', 'fa', 'he', 'ur']);
  const isRtl = rtlLocales.has(locale);
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  document.documentElement.lang = locale.replace('_', '-');
}

// Auto-localize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeI18n);
} else {
  initializeI18n();
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { i18n, localizeHtmlPage, loadLocale, getCurrentLocale, initializeI18n };
}
