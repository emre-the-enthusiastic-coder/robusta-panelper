/**
 * Robusta Scheduler Helper - Content Script
 * 
 * Bu script, Robusta Scheduler web uygulamasında çalışır ve
 * scheduled-processes sayfasından processes sayfasına tarih
 * filtreleme bilgilerini aktarır.
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  
  const CONFIG = {
    // Sayfa pattern'leri
    SCHEDULED_PROCESSES_PATH: '/scheduler/workflow/#/scheduled-processes',
    PROCESSES_PATH: '/scheduler/workflow/#/processes',
    SCREENSHOTS_PATH: '/rpa-admin/#/worker-mgmt-screenshot',
    
    // Tablo sütun indeksleri (0-based, header satırı hariç)
    COLUMN_INDEX: {
      CHECKBOX: 0,
      PROCESS_NAME: 1,
      PROCESS_KEY: 2,
      STATUS: 3,
      SCHEDULED_DATE: 4,
      START_DATE: 5,
      END_DATE: 6,
      CRON: 7,
      RUN_ONCE: 8,
      RUN_IMMEDIATELY: 9,
      PRIORITY: 10,
      PARAMETERS: 11,
      INSTANCES: 12
    },
    
    // Storage key
    STORAGE_KEY: 'robustaFilterDates',
    
    // Timeout değerleri (ms)
    ELEMENT_WAIT_TIMEOUT: 10000,
    ELEMENT_CHECK_INTERVAL: 100,
    DATA_EXPIRY_TIME: 300000, // 5 dakika
    
    // Selectors
    SELECTORS: {
      SCHEDULED_TABLE: 'table.users',
      DATA_ROWS: 'tr[ng-repeat*="scheduledProcess"]',
      FILTER_HEADER: '#process-collapse-header',
      START_DATE_INPUT: 'input[ng-model="model.filter.param.startDateLowerBound"]',
      END_DATE_INPUT: 'input[ng-model="model.filter.param.endDateUpperBound"]',
      // Screenshots selectors
      DATERANGE_INPUT: 'input[type="text"][name="datetimes"]',
      DATERANGE_APPLY_BTN: 'button.applyBtn',
      SCREENSHOTS_FILTER_BTN: 'button[ng-click="showScreenshots()"]'
    }
  };

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Tarih stringinden saniyeyi kaldırır
   * @param {string} dateStr - "2026-01-28 08:02:37" formatında tarih
   * @returns {string} - "2026-01-28 08:02" formatında tarih
   */
  function removeSeconds(dateStr) {
    if (!dateStr || dateStr.length < 16) return dateStr;
    return dateStr.substring(0, 16);
  }

  /**
   * Tarih stringinde dakikayı 1 yukarı yuvarlar
   * @param {string} dateStr - "2026-01-28 08:15:53" formatında tarih
   * @returns {string} - "2026-01-28 08:16" formatında tarih
   */
  function roundUpMinute(dateStr) {
    if (!dateStr) return dateStr;
    
    try {
      // "2026-01-28 08:15:53" -> Date object
      const normalizedDateStr = dateStr.replace(' ', 'T');
      const date = new Date(normalizedDateStr);
      
      if (isNaN(date.getTime())) {
        console.error('Geçersiz tarih formatı:', dateStr);
        return removeSeconds(dateStr);
      }
      
      // 1 dakika ekle
      date.setMinutes(date.getMinutes() + 1);
      date.setSeconds(0);
      date.setMilliseconds(0);
      
      // Format: YYYY-MM-DD HH:mm
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    } catch (error) {
      console.error('Tarih yuvarlama hatası:', error);
      return removeSeconds(dateStr);
    }
  }

  /**
   * Belirli bir koşulun sağlanmasını bekler
   * @param {Function} condition - Koşul fonksiyonu
   * @param {number} timeout - Maksimum bekleme süresi (ms)
   * @returns {Promise<void>}
   */
  function waitFor(condition, timeout = CONFIG.ELEMENT_WAIT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const check = () => {
        if (condition()) {
          resolve();
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout: Koşul sağlanamadı'));
        } else {
          setTimeout(check, CONFIG.ELEMENT_CHECK_INTERVAL);
        }
      };
      
      check();
    });
  }

  /**
   * Kullanıcıya bildirim gösterir
   * @param {string} message - Bildirim mesajı
   * @param {string} type - Bildirim tipi ('success', 'error', 'info')
   */
  function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = 'robusta-notification';
    notification.textContent = message;
    
    if (type === 'error') {
      notification.style.backgroundColor = '#e74c3c';
    } else if (type === 'info') {
      notification.style.backgroundColor = '#3498db';
    }
    
    document.body.appendChild(notification);
    
    // 3 saniye sonra kaldır
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  /**
   * Filter icon SVG'sini döndürür (ana buton için)
   * @returns {string} - SVG markup
   */
  function getMenuIconSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
    </svg>`;
  }

  /**
   * Processes ikonu SVG'si
   * @returns {string} - SVG markup
   */
  function getProcessesIconSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
    </svg>`;
  }

  /**
   * Screenshots ikonu SVG'si
   * @returns {string} - SVG markup
   */
  function getScreenshotsIconSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
    </svg>`;
  }

  /**
   * Açık olan dropdown menüyü kapatır
   */
  function closeAllDropdowns() {
    document.querySelectorAll('.robusta-dropdown-menu').forEach(menu => {
      menu.remove();
    });
    document.querySelectorAll('.robusta-hover-btn-container.menu-open').forEach(container => {
      container.classList.remove('menu-open');
    });
  }

  // Sayfa herhangi bir yerine tıklanınca dropdown'ı kapat
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.robusta-hover-btn-container')) {
      closeAllDropdowns();
    }
  });

  // ============================================
  // SCHEDULED PROCESSES PAGE LOGIC
  // ============================================

  /**
   * Scheduled Processes sayfası için ana fonksiyon
   */
  function initScheduledProcessesPage() {
    console.log('Robusta Helper: Scheduled Processes sayfası tespit edildi');
    
    // Tablo gözlemcisini başlat
    observeTableChanges();
    
    // Mevcut tabloya butonları ekle
    attachHoverButtons();
  }

  /**
   * DOM değişikliklerini izler ve tablo güncellendiğinde butonları ekler
   */
  function observeTableChanges() {
    const observer = new MutationObserver((mutations) => {
      // Tablo veya satır değişikliği varsa butonları yeniden ekle
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          const hasTableChanges = Array.from(mutation.addedNodes).some(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false;
            return node.matches?.(CONFIG.SELECTORS.DATA_ROWS) || 
                   node.querySelector?.(CONFIG.SELECTORS.DATA_ROWS);
          });
          
          if (hasTableChanges) {
            // Debounce ile butonları ekle
            clearTimeout(window.robustaDebounceTimer);
            window.robustaDebounceTimer = setTimeout(attachHoverButtons, 100);
          }
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Tablo satırlarına hover butonlarını ekler
   */
  function attachHoverButtons() {
    const dataRows = document.querySelectorAll(CONFIG.SELECTORS.DATA_ROWS);
    
    dataRows.forEach(row => {
      // Zaten eklenmiş mi kontrol et
      if (row.querySelector('.robusta-hover-btn-container')) {
        return;
      }
      
      // Container oluştur
      const container = document.createElement('div');
      container.className = 'robusta-hover-btn-container';
      
      // Button oluştur
      const button = document.createElement('button');
      button.className = 'robusta-filter-btn';
      button.setAttribute('data-tooltip', 'İşlemler');
      button.innerHTML = getMenuIconSVG();
      
      // Click event - dropdown menüyü aç/kapat
      button.addEventListener('click', (e) => {
        e.stopPropagation(); // Satır seçimini engellemek için
        toggleDropdownMenu(container, row);
      });
      
      container.appendChild(button);
      
      // Satıra ekle (son hücreye - sağ tarafta)
      const cells = row.querySelectorAll('td');
      const lastCell = cells[cells.length - 1];
      if (lastCell) {
        lastCell.style.position = 'relative';
        lastCell.appendChild(container);
      }
    });
    
    console.log(`Robusta Helper: ${dataRows.length} satıra hover butonu eklendi`);
  }

  /**
   * Dropdown menüyü açar/kapatır
   * @param {HTMLElement} container - Button container
   * @param {HTMLElement} row - Tablo satırı
   */
  function toggleDropdownMenu(container, row) {
    // Eğer bu container'da zaten menü varsa kapat
    const existingMenu = container.querySelector('.robusta-dropdown-menu');
    if (existingMenu) {
      closeAllDropdowns();
      return;
    }
    
    // Diğer açık menüleri kapat
    closeAllDropdowns();
    
    // Container'ı menu-open olarak işaretle (görünür kalması için)
    container.classList.add('menu-open');
    
    // Dropdown menü oluştur
    const menu = document.createElement('div');
    menu.className = 'robusta-dropdown-menu';
    
    // Menü öğeleri
    const menuItems = [
      {
        label: "'Processes' sayfasında aç",
        icon: getProcessesIconSVG(),
        action: () => handleOpenInProcesses(row),
        disabled: false
      },
      {
        label: "'Screenshots' sayfasında aç",
        icon: getScreenshotsIconSVG(),
        action: () => handleOpenInScreenshots(row),
        disabled: false // Artık aktif
      }
    ];
    
    menuItems.forEach((item, index) => {
      // Ayırıcı ekle (ilk öğe hariç)
      if (index > 0) {
        const divider = document.createElement('div');
        divider.className = 'robusta-dropdown-divider';
        menu.appendChild(divider);
      }
      
      const menuItem = document.createElement('button');
      menuItem.className = 'robusta-dropdown-item' + (item.disabled ? ' disabled' : '');
      menuItem.innerHTML = item.icon + '<span>' + item.label + '</span>';
      
      if (!item.disabled) {
        menuItem.addEventListener('click', (e) => {
          e.stopPropagation();
          closeAllDropdowns();
          item.action();
        });
      }
      
      menu.appendChild(menuItem);
    });
    
    container.appendChild(menu);
  }

  /**
   * "Processes sayfasında aç" seçeneği tıklandığında çalışır
   * @param {HTMLElement} row - Tıklanan satır elementi
   */
  async function handleOpenInProcesses(row) {
    try {
      // Tarihleri çıkar
      const dates = extractDatesFromRow(row);
      
      if (!dates.startDate || !dates.endDate) {
        showNotification('Tarih bilgisi alınamadı!', 'error');
        return;
      }
      
      console.log('Robusta Helper: Tarihler çıkarıldı', dates);
      
      // Tarihleri formatla
      const formattedDates = {
        startDateLowerBound: removeSeconds(dates.startDate),
        endDateUpperBound: roundUpMinute(dates.endDate),
        timestamp: Date.now()
      };
      
      console.log('Robusta Helper: Formatlanmış tarihler', formattedDates);
      
      // Storage'a kaydet
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: formattedDates
      });
      
      // Processes sayfasını yeni sekmede aç
      const currentUrl = new URL(window.location.href);
      const processesUrl = `${currentUrl.protocol}//${currentUrl.host}${CONFIG.PROCESSES_PATH}`;
      
      window.open(processesUrl, '_blank');
      
      showNotification('Filtre bilgileri aktarılıyor...', 'info');
      
    } catch (error) {
      console.error('Robusta Helper: Hata', error);
      showNotification('Bir hata oluştu: ' + error.message, 'error');
    }
  }

  /**
   * "Screenshots sayfasında aç" seçeneği tıklandığında çalışır
   * @param {HTMLElement} row - Tıklanan satır elementi
   */
  async function handleOpenInScreenshots(row) {
    try {
      // Tarihleri çıkar
      const dates = extractDatesFromRow(row);
      
      if (!dates.startDate || !dates.endDate) {
        showNotification('Tarih bilgisi alınamadı!', 'error');
        return;
      }
      
      console.log('Robusta Helper: Screenshots için tarihler çıkarıldı', dates);
      
      // Tarihleri formatla (Screenshots için aynı format)
      const formattedDates = {
        startDateLowerBound: removeSeconds(dates.startDate),
        endDateUpperBound: roundUpMinute(dates.endDate),
        timestamp: Date.now()
      };
      
      console.log('Robusta Helper: Screenshots için formatlanmış tarihler', formattedDates);
      
      // Storage'a kaydet
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: formattedDates
      });
      
      // Screenshots sayfasını yeni sekmede aç
      const currentUrl = new URL(window.location.href);
      const screenshotsUrl = `${currentUrl.protocol}//${currentUrl.host}${CONFIG.SCREENSHOTS_PATH}`;
      
      window.open(screenshotsUrl, '_blank');
      
      showNotification('Screenshots sayfası açılıyor...', 'info');
      
    } catch (error) {
      console.error('Robusta Helper: Screenshots hatası', error);
      showNotification('Bir hata oluştu: ' + error.message, 'error');
    }
  }

  /**
   * Satırdan tarih bilgilerini çıkarır
   * @param {HTMLElement} row - Tablo satırı
   * @returns {Object} - { startDate, endDate }
   */
  function extractDatesFromRow(row) {
    const cells = row.querySelectorAll('td');
    
    if (cells.length <= CONFIG.COLUMN_INDEX.END_DATE) {
      console.error('Robusta Helper: Yetersiz sütun sayısı');
      return { startDate: null, endDate: null };
    }
    
    const startDate = cells[CONFIG.COLUMN_INDEX.START_DATE]?.textContent?.trim();
    const endDate = cells[CONFIG.COLUMN_INDEX.END_DATE]?.textContent?.trim();
    
    return { startDate, endDate };
  }

  // ============================================
  // PROCESSES PAGE LOGIC
  // ============================================

  /**
   * Processes sayfası için ana fonksiyon
   */
  async function initProcessesPage() {
    console.log('Robusta Helper: Processes sayfası tespit edildi');
    
    try {
      // Storage'dan tarihleri al
      const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      
      if (!data[CONFIG.STORAGE_KEY]) {
        console.log('Robusta Helper: Aktarılacak tarih verisi yok');
        return;
      }
      
      const filterData = data[CONFIG.STORAGE_KEY];
      
      // Verinin taze olduğunu kontrol et
      if (Date.now() - filterData.timestamp > CONFIG.DATA_EXPIRY_TIME) {
        console.log('Robusta Helper: Tarih verisi eskimiş, temizleniyor');
        await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
        return;
      }
      
      console.log('Robusta Helper: Filtre verileri alındı', filterData);
      
      // Input elementlerini bekle ve doldur
      await fillFilterInputs(filterData.startDateLowerBound, filterData.endDateUpperBound);
      
      // Storage'ı temizle
      await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
      
      showNotification('Tarih filtreleri başarıyla ayarlandı!', 'success');
      
    } catch (error) {
      console.error('Robusta Helper: Processes sayfası hatası', error);
      showNotification('Filtre ayarlama hatası: ' + error.message, 'error');
    }
  }

  /**
   * Filter input alanlarını doldurur
   * @param {string} startDate - Başlangıç tarihi
   * @param {string} endDate - Bitiş tarihi
   */
  async function fillFilterInputs(startDate, endDate) {
    // Önce input elementlerinin var olup olmadığını kontrol et
    let startInput = document.querySelector(CONFIG.SELECTORS.START_DATE_INPUT);
    let endInput = document.querySelector(CONFIG.SELECTORS.END_DATE_INPUT);
    
    // Eğer inputlar görünür değilse, filter panelini aç
    if (!startInput || !endInput || !isElementVisible(startInput)) {
      console.log('Robusta Helper: Filter paneli açılıyor...');
      
      const filterHeader = document.querySelector(CONFIG.SELECTORS.FILTER_HEADER);
      
      if (filterHeader) {
        // Panel'i tıklayarak aç
        filterHeader.click();
        
        // Alternatif: openProcessFilters() fonksiyonunu çağır
        try {
          const scope = window.angular?.element(filterHeader)?.scope();
          if (scope && typeof scope.openProcessFilters === 'function') {
            scope.$apply(() => scope.openProcessFilters());
          }
        } catch (e) {
          // Angular scope erişimi başarısız olursa devam et
          console.log('Robusta Helper: Angular scope erişimi alternatif yol denendi');
        }
      }
      
      // Panel açılmasını bekle
      await waitFor(() => {
        const input = document.querySelector(CONFIG.SELECTORS.START_DATE_INPUT);
        return input && isElementVisible(input);
      }, CONFIG.ELEMENT_WAIT_TIMEOUT);
    }
    
    // Input elementlerini tekrar al
    startInput = document.querySelector(CONFIG.SELECTORS.START_DATE_INPUT);
    endInput = document.querySelector(CONFIG.SELECTORS.END_DATE_INPUT);
    
    if (!startInput || !endInput) {
      throw new Error('Filter input elementleri bulunamadı');
    }
    
    // Değerleri set et
    setAngularInputValue(startInput, startDate);
    setAngularInputValue(endInput, endDate);
    
    // Görsel feedback için highlight
    startInput.classList.add('robusta-highlight-input');
    endInput.classList.add('robusta-highlight-input');
    
    setTimeout(() => {
      startInput.classList.remove('robusta-highlight-input');
      endInput.classList.remove('robusta-highlight-input');
    }, 2000);
    
    console.log('Robusta Helper: Filtre değerleri set edildi', { startDate, endDate });
    
    // 'All' state filter butonuna tıkla
    await clickAllStateFilter();
    
    // Search butonuna tıkla
    await clickSearchButton();
  }

  /**
   * 'All' state filter butonuna tıklar (case-insensitive)
   * Buton metni 'all', 'All', 'ALL' veya benzeri olabilir
   */
  async function clickAllStateFilter() {
    try {
      // Küçük bir gecikme ekle (filtre paneli tam açılsın)
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Case-insensitive 'all' butonu bul
      // XPath ile tüm button'ları tara ve normalize edilmiş metni 'all' olanı bul
      const allButtons = Array.from(document.querySelectorAll('.selection.toggle button'));
      
      const allButton = allButtons.find(button => {
        const text = button.textContent.trim().toLowerCase();
        return text === 'all';
      });
      
      if (allButton) {
        // Zaten aktif mi kontrol et
        const parentDiv = allButton.closest('.toggle-3');
        const isActive = parentDiv?.classList.contains('active');
        
        if (!isActive) {
          console.log('Robusta Helper: All butonuna tıklanıyor...');
          allButton.click();
          
          // AngularJS için scope tetikle
          try {
            const scope = window.angular?.element(allButton)?.scope();
            if (scope && scope.$apply) {
              scope.$apply();
            }
          } catch (e) {
            // Scope erişimi başarısız olursa devam et
          }
          
          console.log('Robusta Helper: All state filter aktif edildi');
        } else {
          console.log('Robusta Helper: All state filter zaten aktif');
        }
      } else {
        console.warn('Robusta Helper: All butonu bulunamadı');
      }
    } catch (error) {
      console.error('Robusta Helper: All butonu tıklama hatası', error);
      // Hata olsa bile devam et, kritik değil
    }
  }

  /**
   * Search butonuna tıklar ve filtrelemeyi başlatır
   */
  async function clickSearchButton() {
    try {
      // Küçük bir gecikme ekle (state filter seçimi tamamlansın)
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // ng-click attribute'una göre bul (en güvenilir yöntem)
      let searchButton = document.querySelector('button[ng-click="searchButtonClicked(true)"]');
      
      // Alternatif: translate attribute'una göre
      if (!searchButton) {
        searchButton = document.querySelector('button[translate="SEARCH"]');
      }
      
      // Alternatif: class ve text kombinasyonu
      if (!searchButton) {
        const buttons = Array.from(document.querySelectorAll('button.btn.btn-block'));
        searchButton = buttons.find(btn => {
          const text = btn.textContent.trim().toUpperCase();
          return text === 'SEARCH' || text === 'ARA' || text.includes('SEARCH');
        });
      }
      
      if (searchButton && isElementVisible(searchButton)) {
        console.log('Robusta Helper: Search butonuna tıklanıyor...');
        searchButton.click();
        
        // AngularJS için scope tetikle
        try {
          const scope = window.angular?.element(searchButton)?.scope();
          if (scope && typeof scope.searchButtonClicked === 'function') {
            scope.$apply(() => scope.searchButtonClicked(true));
          } else if (scope && scope.$apply) {
            scope.$apply();
          }
        } catch (e) {
          // Scope erişimi başarısız olursa devam et
        }
        
        console.log('Robusta Helper: Search tetiklendi');
        showNotification('Filtreleme başlatıldı!', 'success');
      } else {
        console.warn('Robusta Helper: Search butonu bulunamadı veya görünür değil');
      }
    } catch (error) {
      console.error('Robusta Helper: Search butonu tıklama hatası', error);
      // Hata olsa bile devam et
    }
  }

  /**
   * Elementin görünür olup olmadığını kontrol eder
   * @param {HTMLElement} element 
   * @returns {boolean}
   */
  function isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetParent !== null;
  }

  /**
   * AngularJS input elementine değer set eder
   * @param {HTMLInputElement} input - Input elementi
   * @param {string} value - Set edilecek değer
   */
  function setAngularInputValue(input, value) {
    // Native value set
    input.value = value;
    input.setAttribute('value', value);
    
    // AngularJS model binding'i tetikle
    // Önce focus
    input.focus();
    
    // Input event
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    
    // Change event
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    
    // KeyUp event (bazı AngularJS uygulamaları için)
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    
    // Blur
    input.blur();
    
    // Angular scope'a direkt erişim dene
    try {
      const ngElement = window.angular?.element(input);
      if (ngElement) {
        const scope = ngElement.scope();
        const ngModel = ngElement.controller('ngModel');
        
        if (ngModel) {
          ngModel.$setViewValue(value);
          ngModel.$render();
        }
        
        if (scope && scope.$apply) {
          scope.$apply();
        }
      }
    } catch (e) {
      // Angular erişimi başarısız olursa sadece native events yeterli olabilir
      console.log('Robusta Helper: Angular model direkt güncelleme denendi');
    }
  }

  // ============================================
  // SCREENSHOTS PAGE LOGIC
  // ============================================

  /**
   * Screenshots sayfası için ana fonksiyon
   */
  async function initScreenshotsPage() {
    console.log('Robusta Helper: Screenshots sayfası tespit edildi');
    
    try {
      // Storage'dan tarihleri al
      const data = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      
      if (!data[CONFIG.STORAGE_KEY]) {
        console.log('Robusta Helper: Aktarılacak tarih verisi yok');
        return;
      }
      
      const filterData = data[CONFIG.STORAGE_KEY];
      
      // Verinin taze olduğunu kontrol et
      if (Date.now() - filterData.timestamp > CONFIG.DATA_EXPIRY_TIME) {
        console.log('Robusta Helper: Tarih verisi eskimiş, temizleniyor');
        await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
        return;
      }
      
      console.log('Robusta Helper: Screenshots filtre verileri alındı', filterData);
      
      // DateRange picker'ı doldur
      await fillDateRangePicker(filterData.startDateLowerBound, filterData.endDateUpperBound);
      
      // Storage'ı temizle
      await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
      
      showNotification('Tarih filtreleri başarıyla ayarlandı!', 'success');
      
    } catch (error) {
      console.error('Robusta Helper: Screenshots sayfası hatası', error);
      showNotification('Filtre ayarlama hatası: ' + error.message, 'error');
    }
  }

  /**
   * DateRangePicker'a tarih aralığını set eder
   * @param {string} startDate - Başlangıç tarihi (YYYY-MM-DD HH:mm)
   * @param {string} endDate - Bitiş tarihi (YYYY-MM-DD HH:mm)
   */
  async function fillDateRangePicker(startDate, endDate) {
    try {
      // Input elementini bekle
      await waitFor(() => {
        const input = document.querySelector(CONFIG.SELECTORS.DATERANGE_INPUT);
        return input && isElementVisible(input);
      }, CONFIG.ELEMENT_WAIT_TIMEOUT);
      
      const dateInput = document.querySelector(CONFIG.SELECTORS.DATERANGE_INPUT);
      
      if (!dateInput) {
        throw new Error('DateRange input elementi bulunamadı');
      }
      
      console.log('Robusta Helper: DateRange picker bulundu, tarihler set ediliyor...');
      
      // Yöntem 1: jQuery DateRangePicker API kullanımı (eğer varsa)
      if (window.$ && typeof window.$.fn.daterangepicker !== 'undefined') {
        console.log('Robusta Helper: jQuery DateRangePicker API kullanılıyor');
        
        const start = parseDateString(startDate);
        const end = parseDateString(endDate);
        
        // DateRangePicker API ile set et
        window.$(dateInput).data('daterangepicker')?.setStartDate(start);
        window.$(dateInput).data('daterangepicker')?.setEndDate(end);
        
        // Apply event'ini tetikle
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const applyBtn = document.querySelector(CONFIG.SELECTORS.DATERANGE_APPLY_BTN);
        if (applyBtn && isElementVisible(applyBtn)) {
          applyBtn.click();
          console.log('Robusta Helper: DateRangePicker Apply tıklandı');
        }
      } 
      // Yöntem 2: AngularJS Scope üzerinden direkt değişken set etme
      else {
        console.log('Robusta Helper: AngularJS scope üzerinden tarihler set ediliyor');
        
        await setScreenshotDatesViaScope(startDate, endDate);
      }
      
      // Filter butonuna tıkla
      await clickScreenshotsFilterButton();
      
    } catch (error) {
      console.error('Robusta Helper: DateRangePicker doldurma hatası', error);
      
      // Fallback: Console'dan manuel müdahale için yardımcı bilgi göster
      console.log('%c=== ROBUSTA HELPER DEBUG ===', 'color: #e74c3c; font-size: 14px; font-weight: bold;');
      console.log('%cTarih set etme başarısız oldu. Manuel test için:', 'color: #3498db;');
      console.log('%cwindow.robustaSetScreenshotDates("' + startDate + '", "' + endDate + '")', 'background: #2c3e50; color: #ecf0f1; padding: 5px;');
      
      throw error;
    }
  }

  /**
   * Tarih stringini Date objesine çevirir
   * @param {string} dateStr - "YYYY-MM-DD HH:mm" formatında
   * @returns {Date}
   */
  function parseDateString(dateStr) {
    const normalizedDateStr = dateStr.replace(' ', 'T');
    return new Date(normalizedDateStr);
  }

  /**
   * Date objesini Screenshots backend formatına çevirir
   * Format: YYYYMMDDHHmmssSSS (örn: 20260128080200000)
   * @param {Date} date - Date objesi
   * @returns {string} - Backend format
   */
  function formatDateForScreenshots(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = '000'; // Her zaman 000
    
    return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
  }

  /**
   * AngularJS scope üzerinden screenshot tarihlerini set eder
   * @param {string} startDate - Başlangıç tarihi
   * @param {string} endDate - Bitiş tarihi
   */
  async function setScreenshotDatesViaScope(startDate, endDate) {
    // Input elementini bul
    const dateInput = document.querySelector(CONFIG.SELECTORS.DATERANGE_INPUT);
    
    if (!dateInput) {
      throw new Error('DateRange input bulunamadı');
    }
    
    // AngularJS scope'u bul
    try {
      const scope = window.angular?.element(dateInput)?.scope();
      
      if (scope) {
        const startDateObj = parseDateString(startDate);
        const endDateObj = parseDateString(endDate);
        
        // Screenshots backend'inin beklediği format: YYYYMMDDHHmmssSSS
        const startDateFormatted = formatDateForScreenshots(startDateObj);
        const endDateFormatted = formatDateForScreenshots(endDateObj);
        
        scope.$apply(() => {
          scope.screenshottingEnabledListStartDate = startDateFormatted;
          scope.screenshottingEnabledListEndDate = endDateFormatted;
          scope.enableShowScreenshottingButton = true; // Filter butonunu aktif et
          
          // Controller'ın checkScreenshottingFilter fonksiyonunu tetikle (eğer varsa)
          if (typeof scope.checkScreenshottingFilter === 'function') {
            scope.checkScreenshottingFilter(startDateFormatted, endDateFormatted);
          }
        });
        
        console.log('Robusta Helper: AngularJS scope değişkenleri set edildi', {
          start: startDateFormatted,
          end: endDateFormatted,
          buttonEnabled: true
        });
        
        // Küçük bir gecikme
        await new Promise(resolve => setTimeout(resolve, 300));
        
        return true;
      }
    } catch (e) {
      console.error('Robusta Helper: AngularJS scope erişim hatası', e);
    }
    
    // Fallback: Input elementini manuel tıklayıp, daterangepicker'ı açmayı dene
    console.log('Robusta Helper: Input elementi tıklanıyor...');
    dateInput.click();
    dateInput.focus();
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // DateRangePicker açıldı mı kontrol et
    const daterangepicker = document.querySelector('.daterangepicker.show-calendar');
    if (daterangepicker) {
      console.log('Robusta Helper: DateRangePicker açıldı ama otomatik set edilemedi');
      console.log('%cManuel olarak tarihleri seçmeniz gerekiyor:', 'color: #f39c12;');
      console.log('Start Date:', startDate);
      console.log('End Date:', endDate);
      throw new Error('DateRangePicker otomatik set edilemedi, manuel seçim gerekli');
    }
    
    return false;
  }

  /**
   * Screenshots Filter butonuna tıklar
   */
  async function clickScreenshotsFilterButton() {
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const filterBtn = document.querySelector(CONFIG.SELECTORS.SCREENSHOTS_FILTER_BTN);
      
      if (filterBtn && isElementVisible(filterBtn) && !filterBtn.disabled) {
        console.log('Robusta Helper: Screenshots Filter butonuna tıklanıyor...');
        filterBtn.click();
        
        // AngularJS scope tetikle
        try {
          const scope = window.angular?.element(filterBtn)?.scope();
          if (scope && typeof scope.showScreenshots === 'function') {
            scope.$apply(() => scope.showScreenshots());
          }
        } catch (e) {
          // Scope erişimi başarısız
        }
        
        console.log('Robusta Helper: Screenshots filtreleme başlatıldı');
        showNotification('Screenshots filtreleme başlatıldı!', 'success');
      } else {
        console.warn('Robusta Helper: Filter butonu bulunamadı, disabled veya görünür değil');
      }
    } catch (error) {
      console.error('Robusta Helper: Filter butonu tıklama hatası', error);
    }
  }

  /**
   * Global helper fonksiyon - Console'dan test için
   * Kullanım: window.robustaSetScreenshotDates("2026-01-28 08:02", "2026-01-28 08:16")
   */
  window.robustaSetScreenshotDates = async function(startDate, endDate) {
    console.log('Robusta Helper: Manuel tarih set etme başlatıldı');
    try {
      await setScreenshotDatesViaScope(startDate, endDate);
      await clickScreenshotsFilterButton();
      console.log('%cBaşarılı!', 'color: #27ae60; font-size: 16px; font-weight: bold;');
    } catch (error) {
      console.error('Hata:', error);
    }
  };

  // ============================================
  // INITIALIZATION
  // ============================================

  /**
   * Sayfa tipini belirler ve uygun başlatma fonksiyonunu çağırır
   */
  function init() {
    const currentPath = window.location.hash || window.location.pathname;
    
    console.log('Robusta Helper: Sayfa yolu', currentPath);
    
    // Hash değişikliklerini dinle (SPA navigasyonu için)
    window.addEventListener('hashchange', () => {
      console.log('Robusta Helper: Hash değişti', window.location.hash);
      handlePageChange();
    });
    
    // İlk yükleme
    handlePageChange();
  }

  /**
   * Sayfa değişikliğini işler
   */
  function handlePageChange() {
    const hash = window.location.hash;
    
    // Küçük bir gecikme ekle (AngularJS render için)
    setTimeout(() => {
      if (hash.includes('/scheduled-processes')) {
        initScheduledProcessesPage();
      } else if (hash.includes('/processes') && !hash.includes('/scheduled-processes')) {
        initProcessesPage();
      } else if (hash.includes('/worker-mgmt-screenshot')) {
        initScreenshotsPage();
      }
    }, 500);
  }

  // Script başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
