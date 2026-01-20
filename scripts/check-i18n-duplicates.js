#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires, no-console */

/**
 * Script to detect CONFLICTING i18n message IDs before extraction.
 *
 * The extract-react-intl-messages tool generates keys based on folder path + message key.
 * Files in the same folder INTENTIONALLY share keys (so translations are reused).
 *
 * This script only flags duplicates where the DEFAULT MESSAGE TEXT differs,
 * which would cause one translation to silently overwrite another.
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

/**
 * Convert file path to i18n key prefix
 * components/Posters/MyComponent.tsx -> components.Posters
 *
 * The extract-react-intl-messages tool uses the FOLDER path, not the filename.
 */
function filePathToKeyPrefix(filePath) {
  const dirPath = path.dirname(filePath);
  let keyPath = dirPath.replace(/^src\//, '');
  if (keyPath === '.' || keyPath === '') {
    keyPath = 'root';
  }
  return keyPath.replace(/\//g, '.');
}

/**
 * Extract message keys AND their default values from defineMessages in a file
 */
function extractMessages(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const messages = [];

  // Match defineMessages({ ... }) - handle nested braces for complex messages
  const defineMessagesRegex = /defineMessages\s*\(\s*\{([\s\S]*?)\}\s*\)/g;

  let match;
  while ((match = defineMessagesRegex.exec(content)) !== null) {
    const messagesBlock = match[1];

    // Extract key-value pairs
    // Matches: keyName: 'value' or keyName: "value" or keyName: `value`
    // Also handles multiline strings
    const keyValueRegex =
      /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|[\s\S]*?defaultMessage\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`))/g;

    let kvMatch;
    while ((kvMatch = keyValueRegex.exec(messagesBlock)) !== null) {
      const key = kvMatch[1];
      // Get the value from whichever capture group matched
      const value =
        kvMatch[2] ||
        kvMatch[3] ||
        kvMatch[4] ||
        kvMatch[5] ||
        kvMatch[6] ||
        kvMatch[7] ||
        '';

      // Skip if this looks like a nested property (like defaultMessage itself)
      if (['defaultMessage', 'description', 'id'].includes(key)) continue;

      messages.push({ key, value: value.trim() });
    }
  }

  return messages;
}

/**
 * Main function
 */
function main() {
  const srcDir = path.join(__dirname, '..', 'src');

  // Find all TypeScript/JavaScript files
  const files = glob.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: srcDir,
    ignore: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**'],
  });

  // Map to track all keys, their values, and source files
  // key -> { value -> [files] }
  const keyToValuesAndFiles = new Map();

  // Process each file
  for (const file of files) {
    const fullPath = path.join(srcDir, file);
    const messages = extractMessages(fullPath);

    if (messages.length === 0) continue;

    const keyPrefix = filePathToKeyPrefix(file);

    for (const { key, value } of messages) {
      const fullKey = `${keyPrefix}.${key}`;

      if (!keyToValuesAndFiles.has(fullKey)) {
        keyToValuesAndFiles.set(fullKey, new Map());
      }

      const valuesMap = keyToValuesAndFiles.get(fullKey);
      if (!valuesMap.has(value)) {
        valuesMap.set(value, []);
      }
      valuesMap.get(value).push(file);
    }
  }

  // Find conflicts (same key, different values)
  const conflicts = [];
  for (const [key, valuesMap] of keyToValuesAndFiles.entries()) {
    if (valuesMap.size > 1) {
      // Multiple different values for the same key = conflict
      conflicts.push({
        key,
        values: Array.from(valuesMap.entries()).map(([value, files]) => ({
          value,
          files,
        })),
      });
    }
  }

  // Report results
  if (conflicts.length === 0) {
    console.log(`${GREEN}✓ No conflicting i18n keys found${RESET}`);
    process.exit(0);
  } else {
    console.error(
      `${RED}✗ Found ${conflicts.length} conflicting i18n key(s):${RESET}\n`
    );
    console.error(
      `${CYAN}These keys have DIFFERENT default messages in different files.`
    );
    console.error(
      `One will silently overwrite the other during extraction.${RESET}\n`
    );

    for (const { key, values } of conflicts) {
      console.error(`${YELLOW}"${key}"${RESET} has conflicting values:`);
      for (const { value, files } of values) {
        const displayValue =
          value.length > 50 ? value.substring(0, 50) + '...' : value;
        console.error(`  ${CYAN}"${displayValue}"${RESET} in:`);
        for (const file of files) {
          console.error(`    - src/${file}`);
        }
      }
      console.error('');
    }

    console.error(
      `${RED}Fix: Rename one of the keys to be unique, e.g.:${RESET}`
    );
    console.error(`  title -> overlaySystemTitle`);
    console.error(`  description -> modalDescription\n`);

    process.exit(1);
  }
}

main();
