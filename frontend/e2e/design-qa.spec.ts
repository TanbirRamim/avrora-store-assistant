import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * Design QA: the acceptance criteria from docs/design-review.md, checked on every screen and
 * every device project. These fail on visual faults (clipped text, sideways scroll, chrome eating
 * the screen, off-palette colour, small targets, low contrast), not on behaviour.
 */

type Screen = { name: string; open: (page: Page) => Promise<void> };

const tab = (name: string) => async (page: Page) => {
  await page.locator("nav").getByRole("button", { name, exact: true }).last().click();
  await page.waitForTimeout(900);
};

const SCREENS: Screen[] = [
  { name: "today", open: async () => {} },
  { name: "team", open: tab("Team") },
  { name: "products", open: tab("Products") },
  {
    name: "product sheet",
    open: async (page) => {
      await tab("Products")(page);
      await page.getByText("Ceramic mug Black").first().click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: "decision sheet",
    open: async (page) => {
      await page.getByRole("button", { name: /Ceramic mug Black/ }).first().click();
      await page.waitForTimeout(900);
    },
  },
  { name: "more", open: tab("More") },
];

/** Text that is cut off: an element showing an ellipsis or clipping its own text. */
async function clippedText(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 1);
      if (!own) continue;
      const cs = getComputedStyle(el);
      // screen-reader-only text is clipped on purpose
      if (el.clientWidth <= 2 || el.clientHeight <= 2 || cs.clip.startsWith("rect(0") || cs.clipPath.includes("inset(50%")) continue;
      if (el.closest("svg")) continue;
      const hides = cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis";
      if (hides && el.scrollWidth > el.clientWidth + 1) out.push(el.textContent!.trim().slice(0, 40));
    }
    return out;
  });
}

/** Yellow belongs to the Avrora logo only. */
async function offPaletteYellow(page: Page) {
  return page.evaluate(() => {
    const yellow = (c: string) => {
      const m = c.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
      if (!m) return false;
      const [r, g, b, a] = [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
      return a > 0.2 && r > 200 && g > 170 && b < 90;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      if (el.closest("svg, img, canvas, .maplibregl-canvas-container")) continue;
      const cs = getComputedStyle(el);
      if (yellow(cs.backgroundColor) || yellow(cs.color) || yellow(cs.borderTopColor)) {
        out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
      }
    }
    return out;
  });
}

/** Interactive elements smaller than 44×44 (phones) — inline text links inside paragraphs excepted. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [role=tab], input, select"))) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
      if (el.tagName === "A" && el.closest("p")) continue;
      if (el.closest(".maplibregl-ctrl-attrib")) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}

/** Height of fixed chrome at the bottom of the screen (tab bar + action bars), as a share of the viewport. */
async function bottomChrome(page: Page) {
  return page.evaluate(() => {
    let top = innerHeight;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.height > innerHeight * 0.6 || r.bottom < innerHeight - 4) continue; // sheets and overlays aren't chrome
      top = Math.min(top, r.top);
    }
    return (innerHeight - top) / innerHeight;
  });
}

for (const s of SCREENS) {
  test(`design QA: ${s.name}`, async ({ page }, info) => {
    const phone = info.project.name !== "desktop";
    await page.goto("/");
    await expect(page.locator("nav").first()).toBeVisible();
    await page.waitForTimeout(1200);
    await s.open(page);

    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect.soft(sideways, "page scrolls sideways").toBeLessThanOrEqual(1);
    expect.soft(await clippedText(page), "clipped or ellipsised text").toEqual([]);
    expect.soft(await offPaletteYellow(page), "yellow outside the logo").toEqual([]);
    if (phone) {
      expect.soft(await smallTargets(page), "tap targets under 44pt").toEqual([]);
      if (!s.name.includes("sheet")) {
        const chrome = await bottomChrome(page);
        expect.soft(chrome, `bottom chrome ${Math.round(chrome * 100)}% of the screen`).toBeLessThanOrEqual(0.2);
      }
    }
    const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect.soft(axe.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" "))), "contrast").toEqual([]);

    await page.screenshot({ path: `e2e/screens/qa/${info.project.name}-${s.name.replace(/ /g, "-")}.png`, fullPage: !s.name.includes("sheet") });
  });
}
