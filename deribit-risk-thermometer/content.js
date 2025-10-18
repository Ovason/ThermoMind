(() => {
  const SELECTOR_IM  = '.css-1dur6yd';   // 你验证过的 IM
  const SELECTOR_MM  = '.css-nkamo5';    // 你验证过的 MM
  const BOX_SELECTOR = '.css-1st174s';   // 要接管的容器
  const FIND_RETRY_MS = 1000;            // 找容器的间隔
  const FIND_MAX_TRY  = 90;              // 最多找 90 次（约 1.5 分钟）
  const UPDATE_MS     = 3000;            // 数值刷新间隔

  // —— 工具 —— //
  const parsePct = (s) => {
    if (!s) return null;
    const m = String(s).match(/(-?\d+(\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]);
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  // 高敏色温：
  //  - 40–65% 为最适区（绿色系，稳定）
  //  - <20% 冷灰（失去生命力）；20–40% 冷色快速过渡到绿
  //  - 65–75% 快速转暖（黄橙）
  //  - ≥75% 进入火红区；>90% 过热衰竭为灰
  const colorFor = (p) => {
    if (p == null || !isFinite(p)) return '#9ca3af'; // 无数据灰
    const v = Math.max(0, Math.min(100, p));

    // 冷/热“失去知觉”：统一用偏暗灰
    const GRAY_DEAD = '#6b7280';

    // 平滑函数（ease-in-out，用于段内插值）
    const ease = (t) => t * t * (3 - 2 * t);

    // 20% 以下：冷灰（失去生命力）
    if (v <= 20) return GRAY_DEAD;

    // 20–40%：由冷蓝快速升温到绿边缘
    if (v <= 40) {
      let t = ease((v - 20) / 20); // 0→1
      const hue = 200 - 60 * t;    // 200(蓝) → 140(青绿)
      const sat = 80 + 5 * t;      // 80% → 85%
      const light = 50 + 4 * t;    // 50% → 54%
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    // 40–65%：最适区，绿系，变化温和（稳定感）
    if (v <= 65) {
      let t = ease((v - 40) / 25); // 0→1
      const hue = 140 - 30 * t;    // 140 → 110（绿→暖绿）
      const sat = 85;              // 保持较高饱和度
      const light = 56 - 2 * t;    // 56% → 54%（轻微沉稳）
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    // 65–75%：快速升温（黄绿→橙），敏感度高
    if (v <= 75) {
      // 为了“快”，用 γ<1 的映射（更陡）
      let t = Math.pow((v - 65) / 10, 0.6); // 0→1 加速
      const hue = 110 - 80 * t;   // 110 → 30（暖绿→橙）
      const sat = 88 + 4 * t;     // 88% → 92%
      const light = 52 - 6 * t;   // 52% → 46%
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    // 75–90%：火红区（橙→红），继续升温但逐步压暗以示压力
    if (v <= 90) {
      let t = (v - 75) / 15;      // 0→1
      const hue = 30 - 30 * t;    // 30（橙）→ 0（红）
      const sat = 94;             // 高饱和
      const light = 46 - 6 * t;   // 46% → 40%
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    // >90%：过热衰竭为灰（失去生命力）
    return GRAY_DEAD;
  };

  // 深度查询：遍历文档及其所有 shadowRoot，找到首个匹配
  function queryDeep(selector) {
    const seen = new Set();
    function walk(root) {
      try {
        if (!root || seen.has(root)) return null;
        seen.add(root);
        const hit = root.querySelector?.(selector);
        if (hit) return hit;
        const nodes = root.querySelectorAll?.('*') || [];
        for (const n of nodes) {
          if (n.shadowRoot) {
            const found = walk(n.shadowRoot);
            if (found) return found;
          }
        }
      } catch (_) {}
      return null;
    }
    return walk(document);
  }

  // 读 IM / MM（优先主文档，读不到再深度找）
  function readIMMM() {
    let imEl = document.querySelectorAll(SELECTOR_IM)[0];
    let mmEl = document.querySelectorAll(SELECTOR_MM)[0];
    if (!imEl) imEl = queryDeep(SELECTOR_IM);
    if (!mmEl) mmEl = queryDeep(SELECTOR_MM);
    const im = imEl ? parsePct(imEl.textContent) : null;
    const mm = mmEl ? parsePct(mmEl.textContent) : null;
    return { im, mm };
  }

  // 我们的内嵌 UI
  function buildInner() {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      display:flex;align-items:center;gap:12px;font-weight:600;
      letter-spacing:.2px;white-space:nowrap;font-size:64px;`;
    const mk = (label,id) => {
      const box=document.createElement('div');
      box.style.cssText='display:flex;align-items:center;gap:6px;font-size:64px;';
      const tag=document.createElement('span');
      tag.textContent=label;
      tag.style.cssText='font-size:11px;opacity:.7;';
      const val=document.createElement('span');
      val.id=id;val.textContent='--';
      val.style.cssText='min-width:56px;text-align:right;';
      box.appendChild(tag);box.appendChild(val);
      return box;
    };
    wrap.appendChild(mk('IM','im-val'));
    wrap.appendChild(mk('MM','mm-val'));
    return wrap;
  }

  // 一次性接管：清空子节点并插入我们的视图
  function takeoverOnce(box) {
    try {
      if (box.id) box.removeAttribute('id'); // 防止按 id 重绘
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(buildInner());
      box.dataset.immmMounted = '1';
      return true;
    } catch (_) {
      return false;
    }
  }

  // 刷新颜色与数值
  function updateValues(box) {
    if (!box || box.dataset.immmMounted !== '1') return;
    const { im, mm } = readIMMM();
    const imEl = box.querySelector('#im-val');
    const mmEl = box.querySelector('#mm-val');
    if (!imEl || !mmEl) return;
    imEl.textContent = im != null ? im.toFixed(1) : '--';
    mmEl.textContent = mm != null ? mm.toFixed(1) : '--';
    imEl.style.color = colorFor(im);
    mmEl.style.color = colorFor(mm);
  }

  // 允许在返回 /dashboard 时手动重挂并刷新
  function mountAndRunNow() {
    const b = queryDeep(BOX_SELECTOR) || document.querySelector(BOX_SELECTOR);
    if (!b) return;
    if (takeoverOnce(b)) {
      updateValues(b);
    } else {
      updateValues(b);
    }
    // 避免重复定时器：统一使用全局句柄
    if (window.__immmUpdateHandle) clearInterval(window.__immmUpdateHandle);
    window.__immmUpdateHandle = setInterval(() => updateValues(b), UPDATE_MS);
  }

  function init() {
    let tries = 0;
    let box = null;

    const findTimer = setInterval(() => {
      tries++;
      box = queryDeep(BOX_SELECTOR) || document.querySelector(BOX_SELECTOR);
      if (box) {
        if (takeoverOnce(box)) {
          updateValues(box);                 // 立即刷新一次
          if (window.__immmUpdateHandle) clearInterval(window.__immmUpdateHandle);
          window.__immmUpdateHandle = setInterval(() => updateValues(box), UPDATE_MS); // 后续定时刷新（带句柄）
          clearInterval(findTimer);          // 找到了就停止轮询
        }
      }
      if (tries >= FIND_MAX_TRY) clearInterval(findTimer);
    }, FIND_RETRY_MS);

    // 监听点击 /dashboard 的链接，返回仪表盘时重挂一次
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href="/dashboard"]') : null;
      if (a) {
        // 给 SPA 一点渲染时间
        setTimeout(mountAndRunNow, 800);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();