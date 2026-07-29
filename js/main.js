/* ============================================================
   Redesign 2026 — interactions
   Preloader, scroll progress, GSAP scroll reveals, split
   headings, counters, 3D tilt cards, timeline draw, nav.
   Everything degrades gracefully without GSAP / with
   prefers-reduced-motion.
   ============================================================ */
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasGSAP = typeof gsap !== 'undefined';
  if (hasGSAP && typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

  /* ---------- Preloader ---------- */
  var pre = document.getElementById('preloader');
  var preBar = document.getElementById('preBar');
  var progress = 0;
  var fakeLoad = setInterval(function () {
    progress = Math.min(progress + Math.random() * 22, 92);
    if (preBar) preBar.style.width = progress + '%';
  }, 120);

  function finishPreloader() {
    clearInterval(fakeLoad);
    if (preBar) preBar.style.width = '100%';
    setTimeout(function () {
      if (pre) pre.classList.add('done');
      heroIntro();
    }, reduceMotion ? 0 : 350);
  }
  if (document.readyState === 'complete') finishPreloader();
  else window.addEventListener('load', finishPreloader);
  setTimeout(finishPreloader, 3500); // hard cap — never trap the user

  /* ---------- Failsafe: never leave the hero hidden ----------
     The title/subtitle/buttons start hidden in CSS and are only
     revealed by the GSAP intro. If that intro is delayed or paused
     (e.g. opened in a background tab, GSAP ticker halted, slow CDN),
     force the hero content visible so it can never disappear. */
  function forceHeroVisible() {
    document.querySelectorAll('.hero-title .line > span').forEach(function (s) {
      if (s.getBoundingClientRect().top > s.parentElement.getBoundingClientRect().bottom - 2) {
        s.style.transform = 'translateY(0)';
      }
    });
    document.querySelectorAll('.hero-kicker, .hero-sub, .hero-actions, .hero-profiles, .hero-stats .stat')
      .forEach(function (el) {
        if (parseFloat(getComputedStyle(el).opacity) < 0.95) { el.style.opacity = '1'; el.style.transform = 'none'; }
      });
    startCounters();
  }
  setTimeout(forceHeroVisible, 4200);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) setTimeout(forceHeroVisible, 1200);
  });

  /* ---------- Hero intro (staggered lines) ---------- */
  var heroPlayed = false;
  function heroIntro() {
    if (heroPlayed) return;
    heroPlayed = true;
    var lines = document.querySelectorAll('.hero-title .line > span');
    if (hasGSAP && !reduceMotion) {
      gsap.to(lines, { y: 0, duration: 1.1, ease: 'power4.out', stagger: 0.12, delay: 0.1 });
      gsap.from('.hero-kicker', { opacity: 0, y: 16, duration: .8, delay: .05 });
      gsap.from('.hero-sub, .hero-actions, .hero-profiles', { opacity: 0, y: 24, duration: .9, stagger: .12, delay: .5 });
      gsap.from('.hero-stats .stat', { opacity: 0, y: 26, duration: .8, stagger: .1, delay: .9, onComplete: startCounters });
    } else {
      lines.forEach(function (s) { s.style.transform = 'none'; });
      startCounters();
    }
  }

  /* ---------- Animated counters ---------- */
  var countersDone = false;
  function startCounters() {
    if (countersDone) return;
    countersDone = true;
    document.querySelectorAll('.stat-num').forEach(function (el) {
      var target = parseInt(el.dataset.count, 10) || 0;
      if (reduceMotion) { el.textContent = target; return; }
      var start = null, dur = 1600;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }
  // Fallback: fire counters when stats scroll into view
  var statsEl = document.querySelector('.hero-stats');
  if (statsEl && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { startCounters(); obs.disconnect(); }
    }, { threshold: 0.4 }).observe(statsEl);
  }

  /* ---------- Scroll progress bar ---------- */
  var progEl = document.getElementById('scrollProgress');
  function updateProgress() {
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    if (progEl) progEl.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  /* ---------- Nav: hide on scroll down, show on scroll up ---------- */
  var nav = document.querySelector('.nav');
  var lastY = 0;
  window.addEventListener('scroll', function () {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('hidden', y > 400 && y > lastY);
    lastY = y;
  }, { passive: true });

  /* ---------- Mobile nav toggle ---------- */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () { links.classList.toggle('open'); });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { links.classList.remove('open'); });
    });
  }

  /* ---------- Scroll reveals ---------- */
  var reveals = document.querySelectorAll('.reveal-up, .reveal-left, .reveal-right');
  if (hasGSAP && typeof ScrollTrigger !== 'undefined' && !reduceMotion) {
    reveals.forEach(function (el) {
      var from = { opacity: 0, y: 0, x: 0 };
      if (el.classList.contains('reveal-up')) from.y = 46;
      if (el.classList.contains('reveal-left')) from.x = -56;
      if (el.classList.contains('reveal-right')) from.x = 56;
      gsap.fromTo(el, from, {
        opacity: 1, x: 0, y: 0, duration: 0.9, ease: 'power3.out',
        scrollTrigger: { trigger: el, start: 'top 86%', once: true }
      });
    });
    // Split headings clip-reveal
    document.querySelectorAll('.split-heading').forEach(function (h) {
      gsap.from(h, {
        yPercent: 60, opacity: 0, duration: 1, ease: 'power4.out',
        scrollTrigger: { trigger: h, start: 'top 88%', once: true }
      });
    });
  } else {
    // IntersectionObserver fallback
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.style.transition = 'opacity .8s ease, transform .8s ease';
            en.target.style.opacity = 1;
            en.target.style.transform = 'none';
            io.unobserve(en.target);
          }
        });
      }, { threshold: 0.12 });
      reveals.forEach(function (el) { io.observe(el); });
    } else {
      reveals.forEach(function (el) { el.style.opacity = 1; el.style.transform = 'none'; });
    }
  }

  /* ---------- Timeline draw-in ---------- */
  document.querySelectorAll('.timeline').forEach(function (tl) {
    if (!('IntersectionObserver' in window)) { tl.style.setProperty('--draw', '100%'); return; }
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) {
        tl.style.setProperty('--draw', '100%');
        obs.disconnect();
      }
    }, { threshold: 0.15 }).observe(tl);
  });

  /* ---------- 3D tilt cards ---------- */
  var finePointer = window.matchMedia('(pointer: fine)').matches;
  if (finePointer && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach(function (card) {
      var maxTilt = 7;
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          'perspective(900px) rotateY(' + (px * maxTilt) + 'deg) rotateX(' + (-py * maxTilt) + 'deg) translateY(-4px)';
      });
      card.addEventListener('pointerleave', function () {
        card.style.transition = 'transform .5s ease';
        card.style.transform = '';
        setTimeout(function () { card.style.transition = ''; }, 500);
      });
    });
  }

  /* ---------- Footer year ---------- */
  var yr = document.getElementById('year');
  if (yr) yr.textContent = new Date().getFullYear();
})();
