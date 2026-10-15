/* 角色收藏室｜網頁基本功能 v1
 * 集中管理頁首按鈕、搜尋、篩選、設定、關閉與鍵盤操作。
 * 依賴 Index.html 提供的全域函式：render、exportData、openEditor、
 * cancelEditor、closeModal、openSettings、setCurrentFilter、toast。
 */
(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function safelyCall(name, ...args) {
    const fn = window[name];
    if (typeof fn === 'function') return fn(...args);
    console.error(`[角色收藏室] 找不到功能：${name}`);
    if (typeof window.toast === 'function') window.toast('功能尚未載入，請重新整理頁面');
    return undefined;
  }

  function closeCurrentView() {
    const params = new URLSearchParams(window.location.search);
    const editorPage = params.get('page') === 'editor' || window.location.pathname.endsWith('/character.html');
    if (editorPage) {
      // 編輯器是整頁模式，不能只隱藏 modal；返回收藏列表才是真正關閉。
      safelyCall('cancelEditor');
      return;
    }
    const backdrop = byId('modalBackdrop');
    if (backdrop && backdrop.classList.contains('open')) {
      safelyCall('closeModal');
      return;
    }
    // 保底：若關閉按鈕被放在沒有開啟 modal 的頁面，也給出可理解的結果。
    if (typeof window.toast === 'function') window.toast('目前沒有開啟的視窗');
  }

  function bind() {
    const addBtn = byId('addTop');
    const settingsBtn = byId('settingsBtn');
    const closeBtn = byId('closeModal');
    const search = byId('search');
    const backdrop = byId('modalBackdrop');
    const filters = byId('filters');

    if (addBtn) addBtn.addEventListener('click', () => safelyCall('openEditor'));
    if (settingsBtn) settingsBtn.addEventListener('click', () => safelyCall('openSettings'));
    if (closeBtn) closeBtn.addEventListener('click', closeCurrentView);

    // 輸入時立即重繪；render 會依名稱、職業、標籤、背景、屬性及技能過濾。
    if (search) {
      search.addEventListener('input', () => safelyCall('render'));
      search.addEventListener('keydown', event => {
        if (event.key === 'Escape' && search.value) {
          event.stopPropagation();
          search.value = '';
          safelyCall('render');
        }
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', event => {
        // 只有點到暗色背景才關閉；點內容區不會誤關。
        if (event.target === backdrop && !document.body.classList.contains('editor-mode')) {
          safelyCall('closeModal');
        }
      });
    }

    if (filters) {
      filters.addEventListener('click', event => {
        const button = event.target.closest('button[data-filter]');
        if (!button) return;
        safelyCall('setCurrentFilter', button.dataset.filter);
      });
    }

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      // 搜尋框有文字時先清除搜尋；否則才關閉視窗／返回列表。
      if (search && document.activeElement === search && search.value) {
        search.value = '';
        safelyCall('render');
        return;
      }
      closeCurrentView();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
