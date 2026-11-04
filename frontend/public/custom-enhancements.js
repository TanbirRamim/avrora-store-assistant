(function () {
  console.log("Initializing Avrora Categorized Category Blocks (Press-to-Expand)...");

  // Distinct High-Resolution Hero Stock Images for the 6 Category Blocks
  const CATEGORY_DATA = {
    Kitchen: {
      icon: "🍳",
      title: "Kitchen & Dining",
      sub: "Cookware, tableware & kitchen accessories",
      image: "https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=600&auto=format&fit=crop&q=80"
    },
    Household: {
      icon: "🧼",
      title: "Household & Cleaning",
      sub: "Cleaning supplies, laundry & home storage",
      image: "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&auto=format&fit=crop&q=80"
    },
    Cosmetics: {
      icon: "💄",
      title: "Cosmetics & Personal Care",
      sub: "Hygiene, skincare & body care",
      image: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&auto=format&fit=crop&q=80"
    },
    Stationery: {
      icon: "✏️",
      title: "Stationery & School",
      sub: "Writing tools, notebooks & office gear",
      image: "https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=600&auto=format&fit=crop&q=80"
    },
    Toys: {
      icon: "🧸",
      title: "Toys & Games",
      sub: "Creative sets, games & children's goods",
      image: "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?w=600&auto=format&fit=crop&q=80"
    },
    Seasonal: {
      icon: "🎄",
      title: "Seasonal & Outdoors",
      sub: "Holiday essentials, outdoor & weather gear",
      image: "https://images.unsplash.com/photo-1512909006721-3d6018887383?w=600&auto=format&fit=crop&q=80"
    }
  };

  function getStatusMeta(status) {
    switch (status) {
      case "running_out":
        return { label: "Running low", class: "chip-running" };
      case "low":
        return { label: "Low stock", class: "chip-running" };
      case "late":
        return { label: "Late delivery", class: "chip-late" };
      case "hard_to_find":
        return { label: "Hard to find", class: "chip-hard" };
      case "overstocked":
        return { label: "Overstocked", class: "chip-over" };
      case "on_order":
        return { label: "On order", class: "chip-ok" };
      default:
        return { label: "In stock", class: "chip-ok" };
    }
  }

  let productsDataCache = null;
  let activeSelectedCategory = null; // null = show Category Blocks overview; string = show that category's product list

  // --- 1. ENHANCE PRODUCTS: CATEGORY BLOCKS OVERVIEW + PRESS-TO-VIEW PRODUCT LIST ---
  async function enhanceProductsView() {
    const listEl = document.querySelector('ul[data-testid="product-list"]');
    if (!listEl) return;

    // Immediately ensure raw list is hidden
    listEl.style.setProperty("display", "none", "important");

    const container = listEl.closest("section");
    if (!container || container.dataset.enhancedCategorized === "true") return;
    container.dataset.enhancedCategorized = "true";

    // Fetch products dataset if not cached
    if (!productsDataCache) {
      try {
        const res = await fetch("/api/products");
        productsDataCache = await res.json();
      } catch (err) {
        console.warn("Could not load products data:", err);
        return;
      }
    }

    const products = (productsDataCache && productsDataCache.products) || [];
    if (products.length === 0) return;

    // Group the real products by category
    const grouped = {};
    const categories = ["Kitchen", "Household", "Cosmetics", "Stationery", "Toys", "Seasonal"];
    categories.forEach(c => grouped[c] = []);

    products.forEach(p => {
      const cat = p.category || "Household";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(p);
    });

    // Clean up any old elements
    const oldNav = container.parentNode.querySelector(".products-category-nav");
    if (oldNav) oldNav.remove();
    const oldOverview = container.querySelector(".category-overview-grid");
    if (oldOverview) oldOverview.remove();
    const oldExpanded = container.querySelector(".category-expanded-view");
    if (oldExpanded) oldExpanded.remove();

    // 1. Category Quick-Navigation Pills
    const navBar = document.createElement("div");
    navBar.className = "products-category-nav";
    navBar.innerHTML = `
      <button type="button" class="cat-pill ${activeSelectedCategory === null ? 'active' : ''}" data-cat="ALL">
        <span>✨ All Categories (${products.length})</span>
      </button>
      ${categories.map(cat => {
        const meta = CATEGORY_DATA[cat] || { icon: "📦", title: cat };
        const count = (grouped[cat] || []).length;
        const isActive = activeSelectedCategory === cat;
        return `
          <button type="button" class="cat-pill ${isActive ? 'active' : ''}" data-cat="${cat}">
            <span>${meta.icon} ${cat} (${count})</span>
          </button>
        `;
      }).join("")}
    `;

    container.parentNode.insertBefore(navBar, container);

    // Pill Click Handler
    navBar.querySelectorAll(".cat-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-cat");
        if (target === "ALL") {
          showOverview();
        } else {
          openCategoryList(target);
        }
      });
    });

    // 2. Render Category Blocks Overview (The 6 Category Cards with distinct Hero Images)
    const overviewGrid = document.createElement("div");
    overviewGrid.className = "category-overview-grid";
    overviewGrid.id = "cat-overview-grid";

    categories.forEach(cat => {
      const items = grouped[cat] || [];
      if (items.length === 0) return;

      const meta = CATEGORY_DATA[cat];
      const lowCount = items.filter(i => i.status === "running_out" || i.status === "low").length;
      const lateCount = items.filter(i => i.status === "late").length;
      let healthText = `${items.length} items in stock`;
      if (lowCount > 0 || lateCount > 0) {
        healthText = `${lowCount ? lowCount + ' running low' : ''}${lowCount && lateCount ? ' · ' : ''}${lateCount ? lateCount + ' late delivery' : ''}`;
      }

      const card = document.createElement("div");
      card.className = "category-overview-card";
      card.setAttribute("data-cat", cat);
      card.innerHTML = `
        <div class="category-hero-img-wrap">
          <img src="${meta.image}" alt="${meta.title}" class="category-hero-img" loading="lazy" />
          <span class="category-hero-badge">${items.length} Products</span>
        </div>
        <div class="category-overview-body">
          <div>
            <div class="category-title-row">
              <div class="category-icon-box">${meta.icon}</div>
              <div>
                <div class="category-card-name">${meta.title}</div>
                <div class="category-card-sub">${meta.sub}</div>
              </div>
            </div>
          </div>
          <div class="category-card-footer">
            <span class="category-health-pill">${healthText}</span>
            <span class="category-view-btn">View List →</span>
          </div>
        </div>
      `;

      card.addEventListener("click", () => {
        openCategoryList(cat);
      });

      overviewGrid.appendChild(card);
    });

    container.appendChild(overviewGrid);

    // 3. Render Expanded View Container (hidden initially)
    const expandedView = document.createElement("div");
    expandedView.className = "category-expanded-view";
    expandedView.id = "cat-expanded-view";
    expandedView.style.display = "none";
    container.appendChild(expandedView);

    function updatePills(activeCat) {
      navBar.querySelectorAll(".cat-pill").forEach(p => {
        const c = p.getAttribute("data-cat");
        if ((activeCat === null && c === "ALL") || c === activeCat) {
          p.classList.add("active");
        } else {
          p.classList.remove("active");
        }
      });
    }

    function showOverview() {
      activeSelectedCategory = null;
      updatePills(null);
      overviewGrid.style.display = "grid";
      expandedView.style.display = "none";
    }

    function openCategoryList(categoryName) {
      activeSelectedCategory = categoryName;
      updatePills(categoryName);

      const items = grouped[categoryName] || [];
      const meta = CATEGORY_DATA[categoryName] || { icon: "📦", title: categoryName };

      expandedView.innerHTML = `
        <div class="expanded-header-bar">
          <div class="expanded-title-area">
            <button type="button" class="expanded-back-btn" id="btn-back-to-categories">
              <span>← All Categories</span>
            </button>
            <div style="font-size: 22px;">${meta.icon}</div>
            <div>
              <div class="expanded-title">${meta.title}</div>
            </div>
            <span class="expanded-count-chip">${items.length} Products</span>
          </div>
        </div>

        <ul class="expanded-product-list">
          ${items.map(p => {
            const status = getStatusMeta(p.status);
            const coverDays = p.days_cover !== null ? `Lasts ${p.days_cover}d` : "No sales";

            return `
              <li class="expanded-product-row" data-name="${(p.name || '').toLowerCase()}" title="Click to view details">
                <div class="product-row-icon-bubble">${meta.icon}</div>
                <div class="product-row-main">
                  <div class="product-row-title">${p.name}</div>
                  <div class="product-row-subline">
                    <span class="status-chip ${status.class}">${status.label}</span>
                    <span class="product-row-stock">${p.stock} in stock</span>
                    <span class="product-row-stock" style="color:#94a3b8;">· ${p.supplier || ''}</span>
                  </div>
                </div>
                <div class="product-row-meta">
                  <div class="product-row-price">₴${Number(p.price).toFixed(2)}</div>
                  <div class="product-row-cover">${coverDays}</div>
                </div>
                <div class="product-row-chevron">›</div>
              </li>
            `;
          }).join("")}
        </ul>
      `;

      // Back button click handler
      expandedView.querySelector("#btn-back-to-categories")?.addEventListener("click", () => {
        showOverview();
      });

      // Product row click -> trigger official drawer
      expandedView.querySelectorAll(".expanded-product-row").forEach(row => {
        row.addEventListener("click", () => {
          const rowName = row.querySelector(".product-row-title")?.textContent?.trim().slice(0, 10) || "";
          const origBtns = listEl.querySelectorAll("button");
          for (let b of origBtns) {
            if (b.textContent.includes(rowName)) {
              b.click();
              break;
            }
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

        // When searching, show matching categories and items
        overviewGrid.querySelectorAll(".category-overview-card").forEach(c => {
          const cat = c.getAttribute("data-cat");
          const hasMatches = (grouped[cat] || []).some(p => (p.name || '').toLowerCase().includes(query));
          c.style.display = hasMatches ? "flex" : "none";
        });

        if (activeSelectedCategory) {
          expandedView.querySelectorAll(".expanded-product-row").forEach(r => {
            const name = r.getAttribute("data-name") || "";
            r.style.display = name.includes(query) ? "flex" : "none";
          });
        }
      });
    }
  }

  // --- 2. ENHANCE MAP SECTION: MOBILE FIX & BRIGHTER BORDER LINE ---
  function enhanceMapSection() {
    const mapContainer = document.querySelector('div[aria-label="Map of the Ukraine supply network"]') || document.querySelector('.h-full.w-full[role="region"]');
    if (!mapContainer) return;

    mapContainer.classList.add("ukraine-border-glow");

    const parent = mapContainer.closest(".relative.h-full.w-full") || mapContainer.parentElement?.parentElement;
    if (!parent) return;

    const overlayCard = parent.querySelector('div.z-10.rounded-\\[14px\\]') || parent.querySelector('div.shadow-\\[0_8px_30px_rgba\\(0\\,0\\,0\\,0\\.12\\)\\]');
    if (!overlayCard || overlayCard.dataset.mobileFixed === "true") return;
    overlayCard.dataset.mobileFixed = "true";

    // On mobile screens (< 768px): collapse by default
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      overlayCard.classList.add("map-drawer-collapsed");
    }

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "map-mobile-drawer-toggle";
    toggleBtn.innerHTML = `
      <span style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:14px;">🗺️</span>
        <span id="map-drawer-label">Supply Network & War Map (7,561 pts)</span>
      </span>
      <span id="map-drawer-icon" style="font-size:12px; font-weight:800;">▼ Controls</span>
    `;

    overlayCard.insertBefore(toggleBtn, overlayCard.firstChild);

    toggleBtn.addEventListener("click", () => {
      const isCollapsed = overlayCard.classList.contains("map-drawer-collapsed");
      if (isCollapsed) {
        overlayCard.classList.remove("map-drawer-collapsed");
        overlayCard.classList.add("map-drawer-expanded");
        document.getElementById("map-drawer-icon").innerText = "▲ Minimize";
      } else {
        overlayCard.classList.add("map-drawer-collapsed");
        overlayCard.classList.remove("map-drawer-expanded");
        document.getElementById("map-drawer-icon").innerText = "▼ Controls";
      }
    });

    if (!parent.querySelector(".map-theme-toggle-floating")) {
      const themeToggle = document.createElement("div");
      themeToggle.className = "map-theme-toggle-floating";
      themeToggle.innerHTML = `
        <button type="button" class="map-theme-btn active" id="btn-theme-light">
          <span>☀️ Light</span>
        </button>
        <button type="button" class="map-theme-btn" id="btn-theme-dark">
          <span>🌙 Tactical Dark</span>
        </button>
      `;

      parent.appendChild(themeToggle);

      const bLight = themeToggle.querySelector("#btn-theme-light");
      const bDark = themeToggle.querySelector("#btn-theme-dark");

      bLight.addEventListener("click", () => {
        bLight.classList.add("active");
        bDark.classList.remove("active");
        mapContainer.classList.remove("map-dark-tactical");
      });

      bDark.addEventListener("click", () => {
        bDark.classList.add("active");
        bLight.classList.remove("active");
        mapContainer.classList.add("map-dark-tactical");
      });
    }
  }

  // Observers
  const observer = new MutationObserver(() => {
    enhanceProductsView();
    enhanceMapSection();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("DOMContentLoaded", () => {
    enhanceProductsView();
    enhanceMapSection();
  });

  document.addEventListener("click", () => {
    setTimeout(() => {
      enhanceProductsView();
      enhanceMapSection();
    }, 120);
  });
})();
