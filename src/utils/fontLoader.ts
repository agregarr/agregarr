// Font preloader utility following Fabric.js recommendations
interface FontInfo {
  family: string;
  fontUrl: string;
}

class FontLoader {
  private loadedFonts = new Set<string>();
  private fontPromises = new Map<string, Promise<void>>();

  /**
   * Load a single font using @font-face and Font Loading API
   */
  async loadFont(fontInfo: FontInfo): Promise<void> {
    const { family, fontUrl } = fontInfo;

    // Return existing promise if font is already being loaded
    if (this.fontPromises.has(family)) {
      const existingPromise = this.fontPromises.get(family);
      if (existingPromise) {
        return existingPromise;
      }
    }

    // Return immediately if font is already loaded
    if (this.loadedFonts.has(family)) {
      return Promise.resolve();
    }

    const promise = this.loadFontInternal(family, fontUrl);
    this.fontPromises.set(family, promise);
    return promise;
  }

  private async loadFontInternal(
    family: string,
    fontUrl: string
  ): Promise<void> {
    // Create @font-face declaration
    const fontFace = new FontFace(family, `url(${fontUrl})`);

    // Load the font
    await fontFace.load();

    // Add to document fonts
    document.fonts.add(fontFace);

    // Mark as loaded
    this.loadedFonts.add(family);
  }

  /**
   * Load multiple fonts in parallel
   */
  async loadFonts(fonts: FontInfo[]): Promise<void> {
    const promises = fonts.map((font) => this.loadFont(font));
    await Promise.all(promises);
  }

  /**
   * Check if a font is loaded
   */
  isFontLoaded(family: string): boolean {
    return this.loadedFonts.has(family);
  }

  /**
   * Wait for a specific font to be available (with timeout)
   */
  async waitForFont(family: string, timeout = 3000): Promise<boolean> {
    if (this.loadedFonts.has(family)) {
      return true;
    }

    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkFont = () => {
        if (this.loadedFonts.has(family)) {
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          resolve(false);
        } else {
          requestAnimationFrame(checkFont);
        }
      };

      checkFont();
    });
  }
}

// Export singleton instance
export const fontLoader = new FontLoader();
