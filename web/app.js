/* ============================================================================
   PRIME STEEL — landing behaviour
   Dependency-free. Header progress, section nav, menu, stock preview,
   Kolkata clock, and an enquiry form that hands off to WhatsApp.
   ========================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hoverCapable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* -- header progress + active section ----------------------------------- */

  var head = document.querySelector("[data-head]");
  var progress = document.querySelector("[data-progress]");
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".head__nav a"));
  var sections = Array.prototype.slice.call(document.querySelectorAll("main section[id]"));
  var ticking = false;

  function paintScroll() {
    if (ticking) return;
    ticking = true;

    window.requestAnimationFrame(function () {
      ticking = false;

      var y = window.scrollY || window.pageYOffset || 0;
      var max = document.documentElement.scrollHeight - window.innerHeight;

      if (progress) {
        var p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
        progress.style.transform = "scaleX(" + p + ")";
      }

      if (head) {
        if (y > 4) head.classList.add("is-stuck");
        else head.classList.remove("is-stuck");
      }

      var line = y + (head ? head.offsetHeight : 0) + 120;
      var current = "";
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].offsetTop <= line) current = sections[i].id;
      }

      navLinks.forEach(function (link) {
        var href = link.getAttribute("href") || "";
        if (href === "#" + current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    });
  }

  window.addEventListener("scroll", paintScroll, { passive: true });
  window.addEventListener("resize", paintScroll, { passive: true });
  paintScroll();

  /* -- menu --------------------------------------------------------------- */

  var menuBtn = document.querySelector("[data-menu]");
  var menuPanel = document.querySelector("[data-menu-panel]");
  var menuClose = document.querySelector("[data-menu-close]");
  var lastFocus = null;
  var closeTimer = 0;
  var inertRegions = [
    document.querySelector("main"),
    document.querySelector(".head"),
    document.querySelector(".foot"),
    document.querySelector(".dock")
  ].filter(Boolean);

  function openMenu() {
    if (!menuPanel || !menuBtn) return;
    lastFocus = document.activeElement;
    window.clearTimeout(closeTimer);
    menuPanel.hidden = false;
    void menuPanel.offsetHeight;
    menuPanel.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("is-locked");
    inertRegions.forEach(function (region) { region.setAttribute("inert", ""); });
    var first = menuPanel.querySelector("[data-menu-link]");
    if (first) first.focus({ preventScroll: true });
  }

  function closeMenu(returnFocus) {
    if (!menuPanel || !menuBtn || menuPanel.hidden) return;
    menuPanel.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-locked");
    inertRegions.forEach(function (region) { region.removeAttribute("inert"); });
    closeTimer = window.setTimeout(function () {
      menuPanel.hidden = true;
    }, reduceMotion ? 0 : 280);
    if (returnFocus === false) return;
    var target = lastFocus && document.contains(lastFocus) ? lastFocus : menuBtn;
    if (target) target.focus({ preventScroll: true });
  }

  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      if (menuBtn.getAttribute("aria-expanded") === "true") closeMenu();
      else openMenu();
    });
  }

  if (menuClose) menuClose.addEventListener("click", function () { closeMenu(); });

  if (menuPanel) {
    menuPanel.addEventListener("click", function (event) {
      if (event.target.closest("[data-menu-link]")) closeMenu(false);
    });
  }

  document.addEventListener("keydown", function (event) {
    var open = menuBtn && menuBtn.getAttribute("aria-expanded") === "true";
    if (!open) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key !== "Tab" || !menuPanel) return;

    var focusables = menuPanel.querySelectorAll("a[href], button:not([disabled])");
    if (!focusables.length) return;

    var first = focusables[0];
    var last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 960 && menuBtn && menuBtn.getAttribute("aria-expanded") === "true") {
      closeMenu(false);
    }
  });

  /* -- scroll reveals ------------------------------------------------------ */

  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  function showAll() {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    showAll();
  } else {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });

    reveals.forEach(function (el) { observer.observe(el); });

    // if a font or image stalls the first paint, never leave content hidden
    window.setTimeout(showAll, 2600);
  }

  /* -- stock preview ------------------------------------------------------- */

  var stock = document.querySelector("[data-stock]");

  if (stock && hoverCapable) {
    var rows = Array.prototype.slice.call(stock.querySelectorAll("[data-row]"));
    var shots = Array.prototype.slice.call(stock.querySelectorAll("[data-preview]"));
    var caption = stock.querySelector("[data-caption]");
    var labels = {
      coils: "Stock / stainless coils",
      sheets: "Stock / sheets",
      pipes: "Stock / pipes"
    };

    function select(key) {
      rows.forEach(function (row) {
        row.classList.toggle("is-active", row.getAttribute("data-row") === key);
      });
      shots.forEach(function (shot) {
        shot.classList.toggle("is-on", shot.getAttribute("data-preview") === key);
      });
      if (caption && labels[key]) caption.textContent = labels[key];
    }

    rows.forEach(function (row) {
      var key = row.getAttribute("data-row");
      row.addEventListener("pointerenter", function () { select(key); });
      row.addEventListener("focusin", function () { select(key); });
    });
  }

  /* -- Kolkata clock ------------------------------------------------------- */

  var clocks = document.querySelectorAll("[data-clock]");
  var clockFormat = null;

  try {
    clockFormat = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata"
    });
  } catch (err) {
    clockFormat = null;
  }

  function paintClock() {
    if (!clockFormat || !clocks.length) return;
    var now = new Date();
    var text = clockFormat.format(now);
    if (text === "24:00") text = "00:00";
    for (var i = 0; i < clocks.length; i++) {
      clocks[i].textContent = text;
      clocks[i].setAttribute("datetime", now.toISOString());
    }
  }

  paintClock();
  window.setInterval(paintClock, 20000);

  /* -- enquiry form -------------------------------------------------------- */

  var form = document.getElementById("quote-form");

  if (form) {
    var nameEl = form.querySelector("#f-name");
    var phoneEl = form.querySelector("#f-phone");
    var emailEl = form.querySelector("#f-email");
    var companyEl = form.querySelector("#f-company");
    var needEl = form.querySelector("#f-need");
    var messageEl = form.querySelector("#f-msg");
    var statusEl = form.querySelector("[data-form-status]");
    var timer = 0;

    function fieldOf(el) { return el.closest(".field"); }

    function setError(el, message) {
      var field = fieldOf(el);
      if (!field) return;
      field.classList.add("is-invalid");
      el.setAttribute("aria-invalid", "true");
      var err = field.querySelector("[data-err]");
      if (err) err.textContent = message;
    }

    function clearError(el) {
      var field = fieldOf(el);
      if (!field) return;
      field.classList.remove("is-invalid");
      el.removeAttribute("aria-invalid");
      var err = field.querySelector("[data-err]");
      if (err) err.textContent = "";
    }

    function validate() {
      var invalid = [];

      if (!nameEl.value.trim() || nameEl.value.trim().length < 2) {
        setError(nameEl, "Tell us who we're quoting for.");
        invalid.push(nameEl);
      } else {
        clearError(nameEl);
      }

      var digits = phoneEl.value.replace(/\D/g, "");
      if (!phoneEl.value.trim()) {
        setError(phoneEl, "A number lets us call you back.");
        invalid.push(phoneEl);
      } else if (digits.length < 7 || digits.length > 15) {
        setError(phoneEl, "Check the number — 7 to 15 digits.");
        invalid.push(phoneEl);
      } else {
        clearError(phoneEl);
      }

      var email = emailEl.value.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setError(emailEl, "That email doesn't look complete.");
        invalid.push(emailEl);
      } else {
        clearError(emailEl);
      }

      return invalid;
    }

    [nameEl, phoneEl, emailEl].forEach(function (el) {
      el.addEventListener("input", function () {
        var field = fieldOf(el);
        if (field && field.classList.contains("is-invalid")) clearError(el);
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      window.clearTimeout(timer);

      var invalid = validate();
      if (invalid.length) {
        statusEl.textContent = "Please check the marked fields.";
        invalid[0].focus();
        return;
      }

      var lines = [
        "New enquiry — Prime Steel",
        "",
        "Name: " + nameEl.value.trim(),
        "Company: " + (companyEl.value.trim() || "—"),
        "Phone: " + phoneEl.value.trim(),
        "Email: " + (emailEl.value.trim() || "—"),
        "Requirement: " + needEl.value,
        "",
        "Message: " + (messageEl.value.trim() || "—")
      ];

      var url = "https://wa.me/917439436381?text=" + encodeURIComponent(lines.join("\n"));

      var link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();

      statusEl.textContent = "Opening WhatsApp with your details…";

      timer = window.setTimeout(function () {
        statusEl.textContent = "If WhatsApp didn't open, call +91 74394 36381.";
      }, 2800);
    });
  }
})();
