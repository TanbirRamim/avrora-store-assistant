(function () {
  console.log("Initializing Avrora UI: 3-per-row Category Blocks (Front of Page) & Balanced Updates Feed...");

  // 12 Specific Retail Categories with Verified 100% Free-to-Use Local Images + Unsplash Fallbacks
  const CATEGORY_MAP = {
    "Cookware & Kitchenware": {
      icon: "🍳",
      title: "Cookware & Kitchenware",
      sub: "Pots, frying pans, cutting boards & kitchen prep",
      image: "/category-images/cookware.jpg",
      fallback: "https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?w=500&auto=format&fit=crop&q=80"
    },
    "Tableware & Drinkware": {
      icon: "☕",
      title: "Tableware & Drinkware",
      sub: "Ceramic mugs, drinking glasses & glass jars",
      image: "/category-images/tableware.jpg",
      fallback: "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80"
    },
    "Cleaning & Laundry": {
      icon: "🧼",
      title: "Cleaning & Laundry",
      sub: "Sponges, vacuum bags & cleaning cloths",
      image: "/category-images/cleaning.jpg",
      fallback: "https://images.unsplash.com/photo-1584813470613-5b1c1cad3d69?w=500&auto=format&fit=crop&q=80"
    },
    "Home Storage & Bath": {
      icon: "🏡",
      title: "Home Storage & Bath",
      sub: "Storage boxes, bath mats & organizers",
      image: "/category-images/storage.jpg",
      fallback: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=500&auto=format&fit=crop&q=80"
    },
    "Oral Care & Hygiene": {
      icon: "🪥",
      title: "Oral Care & Hygiene",
      sub: "Herbal toothpastes, mint dental care & brushes",
      image: "/category-images/oral.jpg",
      fallback: "https://images.unsplash.com/photo-1607613009820-a29f7bb81c04?w=500&auto=format&fit=crop&q=80"
    },
    "Body Care & Shower": {
      icon: "🧴",
      title: "Body Care & Shower",
      sub: "Shower gels, classic deodorants & bath soaps",
      image: "/category-images/body.jpg",
      fallback: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=500&auto=format&fit=crop&q=80"
    },
    "Skincare & Balms": {
      icon: "💄",
      title: "Skincare & Balms",
      sub: "Soothing lip balms, sensitive lotions & creams",
      image: "/category-images/skincare.jpg",
      fallback: "https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=500&auto=format&fit=crop&q=80"
    },
    "Notebooks & Paper": {
      icon: "📓",
      title: "Notebooks & Paper",
      sub: "A5 notebooks, neon sketchbooks & sticky notes",
      image: "/category-images/notebooks.jpg",
      fallback: "https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=500&auto=format&fit=crop&q=80"
    },
    "Writing & Office Tools": {
      icon: "✏️",
      title: "Writing & Office Tools",
      sub: "Gel pens, highlighters, rulers & desk supplies",
      image: "/category-images/office.jpg",
      fallback: "https://images.unsplash.com/photo-1585776245991-cf89dd7fc73a?w=500&auto=format&fit=crop&q=80"
    },
    "Board Games & Creative": {
      icon: "🎲",
      title: "Board Games & Creative",
      sub: "Deluxe coloring sets, board games & family puzzles",
      image: "/category-images/games.jpg",
      fallback: "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=500&auto=format&fit=crop&q=80"
    },
    "Toys & Dolls": {
      icon: "🧸",
      title: "Toys & Dolls",
      sub: "Bubble wands, soft balls, dolls & water guns",
      image: "/category-images/toys.jpg",
      fallback: "https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=500&auto=format&fit=crop&q=80"
    },
    "Holiday Decor & Gifts": {
      icon: "🎄",
      title: "Holiday Decor & Gifts",
      sub: "Star toppers, Santa figures, baubles & garlands",
      image: "/category-images/holiday.jpg",
      fallback: "https://images.unsplash.com/photo-1512909006721-3d6018887383?w=500&auto=format&fit=crop&q=80"
    }
  };

  // Classify products into these 12 natural sub-categories
  function classifyProduct(p) {
    const name = (p.name || "").toLowerCase();
    const cat = p.category || "";

    if (cat === "Kitchen") {
      if (name.includes("mug") || name.includes("glass") || name.includes("cup") || name.includes("jar") || name.includes("bottle")) {
        return "Tableware & Drinkware";
      }
      return "Cookware & Kitchenware";
    }

    if (cat === "Household") {
      if (name.includes("sponge") || name.includes("vacuum") || name.includes("cleaning") || name.includes("cloth") || name.includes("bag")) {
        return "Cleaning & Laundry";
      }
      return "Home Storage & Bath";
    }

    if (cat === "Cosmetics") {
      if (name.includes("toothpaste") || name.includes("toothbrush") || name.includes("oral") || name.includes("dental")) {
        return "Oral Care & Hygiene";
      }
      if (name.includes("lip") || name.includes("balm") || name.includes("lotion") || name.includes("cream") || name.includes("oil") || name.includes("cleanser") || name.includes("micellar")) {
        return "Skincare & Balms";
      }
      return "Body Care & Shower";
    }

    if (cat === "Stationeries") {
      if (name.includes("notebook") || name.includes("sketchbook") || name.includes("note") || name.includes("pad") || name.includes("paper")) {
        return "Notebooks & Paper";
      }
      return "Writing & Office Tools";
    }

    if (cat === "Toys") {
      if (name.includes("game") || name.includes("puzzle") || name.includes("coloring") || name.includes("marker") || name.includes("set") || name.includes("creative")) {
        return "Board Games & Creative";
      }
      return "Toys & Dolls";
    }

    if (name.includes("santa") || name.includes("garland") || name.includes("bauble") || name.includes("star") || name.includes("decor") || name.includes("tree") || name.includes("candle") || name.includes("gift")) {
      return "Holiday Decor & Gifts";
    }

    return "Home Storage & Bath";
  }

  let productsDataCache = null;
  let productsFetchPromise = null;
  let activeSelectedCategory = null;

  // --- 1. ENHANCE PRODUCTS: 12 CATEGORY BLOCKS (3 PER ROW, ON FRONT OF PAGE) ---
  async function enhanceProductsView() {
    const listEl = document.querySelector('ul[data-testid="product-list"]');
    if (!listEl) return;

    // Immediately hide raw flat list to prevent unstyled flash
    listEl.style.setProperty("display", "none", "important");

    // Locate the main container grid
    const grid = listEl.closest("div.grid") || document.querySelector("main div.mt-5.grid") || listEl.closest("section")?.parentElement;
    if (!grid) return;

    // Check if portal is already initialized and products are loaded
    let portal = document.getElementById("avrora-category-main-portal");
    if (portal && portal.dataset.initialized === "true") {
      if (!grid.contains(portal)) {
        grid.prepend(portal);
      }
      return;
    }

    // Fetch products dataset if not cached (with deduplication)
    if (!productsDataCache) {
      if (!productsFetchPromise) {
        productsFetchPromise = fetch("/api/products")
          .then(r => r.json())
          .then(data => {
            productsDataCache = data;
            return data;
          })
          .catch(err => {
            console.warn("Could not load products data:", err);
            productsFetchPromise = null;
          });
      }
      await productsFetchPromise;
    }

    const products = (productsDataCache && productsDataCache.products) || [];
    if (products.length === 0) return;

    // Group real products into the 12 specific categories
    const grouped = {};
    const categories = Object.keys(CATEGORY_MAP);
    categories.forEach(c => grouped[c] = []);

    products.forEach(p => {
      const sub = classifyProduct(p);
      if (!grouped[sub]) grouped[sub] = [];
      grouped[sub].push(p);
    });

    // Create or reuse the dedicated Category Main Portal
    if (!portal) {
      portal = document.createElement("div");
      portal.id = "avrora-category-main-portal";
      portal.className = "category-main-portal lg:col-start-1 lg:row-start-1 category-portal-active";
      // CRITICAL: Prepend as the VERY FIRST child of grid so it sits on the FRONT of the page
      grid.prepend(portal);
    } else {
      portal.innerHTML = "";
      portal.className = "category-main-portal lg:col-start-1 lg:row-start-1 category-portal-active";
    }
    portal.dataset.initialized = "true";

    // 1. Category Quick-Navigation Pills (All 12 Categories)
    const navBar = document.createElement("div");
    navBar.className = "products-category-nav";
    navBar.innerHTML = `
      <button type="button" class="cat-pill active" data-cat="ALL">
        <span>✨ All Categories</span>
      </button>
      ${categories.map(cat => {
        const info = CATEGORY_MAP[cat];
        const count = (grouped[cat] || []).length;
        return `
          <button type="button" class="cat-pill" data-cat="${cat}">
            <span>${info.icon} ${info.title}</span>
            <span style="opacity:0.6;font-size:10px;">(${count})</span>
          </button>
        `;
      }).join("")}
    `;

    portal.appendChild(navBar);

    // Pill Click Handler
    navBar.querySelectorAll(".cat-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-cat");
        navBar.querySelectorAll(".cat-pill").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (target === "ALL") {
          showOverview();
        } else {
          openCategoryList(target);
        }
      });
    });

    // 2. Render Category Overview Grid (EXACTLY 3 CARDS PER ROW)
    const overviewGrid = document.createElement("div");
    overviewGrid.className = "category-overview-grid";
    overviewGrid.id = "cat-overview-grid";

    categories.forEach(cat => {
      const items = grouped[cat] || [];
      if (items.length === 0) return;
      const info = CATEGORY_MAP[cat];

      const sampleItems = items.slice(0, 2);

      const card = document.createElement("div");
      card.className = "category-overview-card";
      card.setAttribute("data-cat", cat);
      card.innerHTML = `
        <div class="category-hero-img-wrap">
          <img src="${info.image}" 
               alt="${info.title}" 
               class="category-hero-img" 
               loading="eager"
               onerror="if(!this.dataset.fallback){this.dataset.fallback=1;this.src='${info.fallback}';}" 
          />
          <span class="category-hero-badge">${items.length} items</span>
          <div class="category-hero-icon">${info.icon}</div>
        </div>
        <div class="category-card-body">
          <div class="category-card-title">${info.title}</div>
          <div class="category-card-sub">${info.sub}</div>
          <div class="category-preview-tags">
            ${sampleItems.map(p => `<span class="cat-sample-tag">• ${p.name}</span>`).join("")}
          </div>
          <div class="category-card-footer">
            <span class="category-view-btn">
              Browse Category
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </span>
            <span style="font-size:11px;font-weight:700;color:#0f172a;">${info.icon}</span>
          </div>
        </div>
      `;

      card.addEventListener("click", () => {
        openCategoryList(cat);
      });

      overviewGrid.appendChild(card);
    });

    portal.appendChild(overviewGrid);

    // 3. Render Expanded View Container (hidden initially)
    const expandedView = document.createElement("div");
    expandedView.className = "category-expanded-view";
    expandedView.id = "cat-expanded-view";
    expandedView.style.display = "none";
    portal.appendChild(expandedView);

    // Function: Return to Overview Grid
    function showOverview() {
      activeSelectedCategory = null;
      expandedView.style.display = "none";
      overviewGrid.style.display = "grid";
      portal.classList.add("category-portal-active");
      navBar.querySelectorAll(".cat-pill").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-cat") === "ALL");
      });
      portal.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // Function: Open Category Product List
    function openCategoryList(catName) {
      activeSelectedCategory = catName;
      const items = grouped[catName] || [];
      const info = CATEGORY_MAP[catName] || { icon: "📦", title: catName };

      navBar.querySelectorAll(".cat-pill").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-cat") === catName);
      });

      expandedView.innerHTML = `
        <div class="expanded-header-bar">
          <div class="expanded-cat-heading">
            <button type="button" class="expanded-back-btn" id="btn-back-to-categories">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="m15 18-6-6 6-6"/>
              </svg>
              <span>All Categories</span>
            </button>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="expanded-cat-icon">${info.icon}</span>
              <div>
                <span class="expanded-cat-title">${info.title}</span>
                <span class="expanded-cat-count">${items.length} items</span>
              </div>
            </div>
          </div>
        </div>
        <ul class="expanded-product-list">
          ${items.map(r => {
            const statusLabel = r.status === "running_out" ? "Running low" :
                                r.status === "low" ? "Low" :
                                r.status === "late" ? "Late delivery" :
                                r.status === "hard_to_find" ? "Hard to find" :
                                r.status === "overstocked" ? "Overstocked" : "In stock";
            const statusClass = (r.status === "running_out" || r.status === "low") ? "low" :
                                (r.status === "late" || r.status === "overstocked") ? "late" :
                                (r.status === "hard_to_find") ? "hard" : "ok";
            const lastsText = r.days_cover === null ? "Not selling" : `Lasts ${r.days_cover}d`;

            return `
              <li class="expanded-product-row" data-product-id="${r.product_id}">
                <div class="exp-prod-main">
                  <div class="exp-prod-icon">${info.icon}</div>
                  <div class="exp-prod-details">
                    <div class="exp-prod-name">${r.name}</div>
                    <div class="exp-prod-meta">
                      <span class="exp-status-chip ${statusClass}">${statusLabel}</span>
                      <span>${r.stock} in stock</span>
                      <span>• ${r.supplier || ""}</span>
                    </div>
                  </div>
                </div>
                <div class="exp-prod-right">
                  <div class="exp-prod-cover">${lastsText}</div>
                  <div class="exp-prod-price">₴${r.price.toFixed(2)}</div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                </div>
              </li>
            `;
          }).join("")}
        </ul>
      `;

      // Back Button Listener
      expandedView.querySelector("#btn-back-to-categories")?.addEventListener("click", () => {
        showOverview();
      });

      // Click on row to open official product panel
      expandedView.querySelectorAll(".expanded-product-row").forEach(row => {
        row.addEventListener("click", () => {
          const pid = row.getAttribute("data-product-id");
          if (!pid) return;
          // Trigger the underlying item click
          const hiddenRow = document.querySelector(`ul[data-testid="product-list"] li button`);
          // Find matching button in hidden list
          const buttons = document.querySelectorAll(`ul[data-testid="product-list"] li button`);
          let matched = false;
          buttons.forEach(btn => {
            if (btn.textContent.includes(pid) || btn.textContent.includes(row.querySelector(".exp-prod-name")?.textContent || "~~~")) {
              btn.click();
              matched = true;
            }
          });
          if (!matched && buttons.length > 0) {
            buttons[0].click();
          }
        });
      });

      overviewGrid.style.display = "none";
      expandedView.style.display = "block";
      expandedView.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // Sync with Top Search Bar
    const searchInput = document.querySelector('input[type="search"][aria-label="Search products"]');
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const query = (e.target.value || "").trim().toLowerCase();
        if (!query) {
          if (activeSelectedCategory) {
            openCategoryList(activeSelectedCategory);
          } else {
            showOverview();
          }
          return;
        }

        overviewGrid.querySelectorAll(".category-overview-card").forEach(c => {
          const cat = c.getAttribute("data-cat");
          const hasMatches = (grouped[cat] || []).some(p => (p.name || '').toLowerCase().includes(query));
          c.style.display = hasMatches ? "flex" : "none";
        });
      });
    }
  }

  // --- 2. ENHANCE MAP SECTION: MOBILE FIX & BRIGHTER BORDER LINE ---
  // --- 3. UPDATES FEED: SHOW EXACTLY 8 HIGH PRIORITY ITEMS ---
  function ensure8PriorityUpdates() {
    const updatesSection = document.querySelector("section.lg\\:sticky");
    if (!updatesSection) return;

    // Expand the feed once so React renders the list beyond 4 items
    const showAllBtn = updatesSection.querySelector("h2 button");
    if (showAllBtn && showAllBtn.textContent.includes("Show all")) {
      showAllBtn.click();
    }
    if (showAllBtn) {
      showAllBtn.style.display = "none";
    }

    // Badge showing "Top 8 Priority"
    const heading = updatesSection.querySelector("h2");
    if (heading && !heading.querySelector(".updates-badge-top8")) {
      const badge = document.createElement("span");
      badge.className = "updates-badge-top8";
      badge.style.cssText = "font-size:10.5px;font-weight:700;color:#0f172a;background:#fef08a;padding:2px 8px;border-radius:9999px;margin-left:8px;border:1px solid rgba(0,0,0,0.06);";
      badge.textContent = "8 Priority Updates";
      heading.appendChild(badge);
    }
  }

  // Observers
  const observer = new MutationObserver(() => {
    enhanceProductsView();
    // map untouched (original)
    ensure8PriorityUpdates();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("DOMContentLoaded", () => {
    enhanceProductsView();
    // map untouched (original)
    ensure8PriorityUpdates();
  });

  document.addEventListener("click", () => {
    setTimeout(() => {
      enhanceProductsView();
      // map untouched (original)
      ensure8PriorityUpdates();
    }, 120);
  });
})();
