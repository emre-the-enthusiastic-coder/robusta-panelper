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
    
    // Instance tablosu sütun indeksleri
    INSTANCE_COLUMN_INDEX: {
      STATUS: 0,
      WAITING_REASON: 1,
      USERNAME: 2,
      START_DATE: 3,
      END_DATE: 4,
      WORKER_NAME: 5,
      SHOW_LOGS: 6,
      SHOW_DIAGRAM: 7
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
      INSTANCE_DATA_ROWS: 'tr[ng-repeat*="processInstance"]',
      FILTER_HEADER: '#process-collapse-header',
      START_DATE_INPUT: 'input[ng-model="model.filter.param.startDateLowerBound"]',
      END_DATE_INPUT: 'input[ng-model="model.filter.param.endDateUpperBound"]',
      // Screenshots selectors
      DATERANGE_INPUT: 'input[type="text"][name="datetimes"]',
      DATERANGE_APPLY_BTN: 'button.applyBtn',
      SCREENSHOTS_FILTER_BTN: 'button[ng-click="showScreenshots()"]',
      SCREENSHOTS_WORKER_SELECT: 'select[ng-model="screenshottingModel"]'
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
   * Chrome API'nin mevcut olup olmadığını kontrol eder
   * @returns {boolean}
   */
  function isChromeApiAvailable() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
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
            // Sadece instance satırlarını izle
            return node.matches?.(CONFIG.SELECTORS.INSTANCE_DATA_ROWS) || 
                   node.querySelector?.(CONFIG.SELECTORS.INSTANCE_DATA_ROWS);
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
   * NOT: Sadece Instance satırlarına buton eklenir
   */
  function attachHoverButtons() {
    // Sadece Instance satırları
    const instanceRows = document.querySelectorAll(CONFIG.SELECTORS.INSTANCE_DATA_ROWS);
    
    instanceRows.forEach(row => {
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
    
    console.log(`Robusta Helper: ${instanceRows.length} instance satırına hover butonu eklendi`);
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
    
    // Menü öğeleri - Processes ve Screenshots seçenekleri
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
        disabled: false
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
      // Chrome API kontrolü
      if (!isChromeApiAvailable()) {
        showNotification('Extension yeniden yükleniyor, lütfen tekrar deneyin', 'error');
        console.error('Robusta Helper: Chrome API mevcut değil');
        return;
      }
      
      // Tarihleri çıkar
      const data = extractDataFromRow(row);
      
      if (!data.startDate || !data.endDate) {
        showNotification('Tarih bilgisi alınamadı!', 'error');
        return;
      }
      
      console.log('Robusta Helper: Tarihler çıkarıldı', data);
      
      // Tarihleri formatla
      const formattedDates = {
        startDateLowerBound: removeSeconds(data.startDate),
        endDateUpperBound: roundUpMinute(data.endDate),
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
      // Chrome API kontrolü
      if (!isChromeApiAvailable()) {
        showNotification('Extension yeniden yükleniyor, lütfen tekrar deneyin', 'error');
        console.error('Robusta Helper: Chrome API mevcut değil');
        return;
      }
      
      // Tarihleri ve robot bilgisini çıkar
      const data = extractDataFromRow(row);
      
      if (!data.startDate || !data.endDate) {
        showNotification('Tarih bilgisi alınamadı!', 'error');
        return;
      }
      
      console.log('Robusta Helper: Screenshots için tarihler ve robot çıkarıldı', data);
      
      // Tarihleri ve robot bilgisini formatla
      const formattedData = {
        startDateLowerBound: removeSeconds(data.startDate),
        endDateUpperBound: roundUpMinute(data.endDate),
        workerName: data.workerName || null,
        timestamp: Date.now()
      };
      
      console.log('Robusta Helper: Screenshots için formatlanmış veriler', formattedData);
      
      // Storage'a kaydet
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: formattedData
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
   * Satırdan tarih ve robot bilgilerini çıkarır
   * @param {HTMLElement} row - Tablo satırı
   * @returns {Object} - { startDate, endDate, workerName }
   */
  function extractDataFromRow(row) {
    const cells = row.querySelectorAll('td');
    
    // Satır tipini belirle (scheduled process mi, instance mı?)
    const isInstanceRow = row.getAttribute('ng-repeat')?.includes('processInstance');
    
    let startDate, endDate, workerName;
    
    if (isInstanceRow) {
      // Instance tablosu
      if (cells.length <= CONFIG.INSTANCE_COLUMN_INDEX.END_DATE) {
        console.error('Robusta Helper: Instance tablosu - Yetersiz sütun sayısı');
        return { startDate: null, endDate: null, workerName: null };
      }
      startDate = cells[CONFIG.INSTANCE_COLUMN_INDEX.START_DATE]?.textContent?.trim();
      endDate = cells[CONFIG.INSTANCE_COLUMN_INDEX.END_DATE]?.textContent?.trim();
      workerName = cells[CONFIG.INSTANCE_COLUMN_INDEX.WORKER_NAME]?.textContent?.trim();
    } else {
      // Scheduled Processes tablosu
      if (cells.length <= CONFIG.COLUMN_INDEX.END_DATE) {
        console.error('Robusta Helper: Yetersiz sütun sayısı');
        return { startDate: null, endDate: null, workerName: null };
      }
      startDate = cells[CONFIG.COLUMN_INDEX.START_DATE]?.textContent?.trim();
      endDate = cells[CONFIG.COLUMN_INDEX.END_DATE]?.textContent?.trim();
      workerName = null; // Scheduled Processes'te worker bilgisi yok
    }
    
    return { startDate, endDate, workerName };
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
      // Chrome API kontrolü
      if (!isChromeApiAvailable()) {
        console.error('Robusta Helper: Chrome API mevcut değil');
        return;
      }
      
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
      // Chrome API kontrolü
      if (!isChromeApiAvailable()) {
        console.error('Robusta Helper: Chrome API mevcut değil');
        return;
      }
      
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
      
      // Robot seçimi yap (eğer workerName varsa)
      if (filterData.workerName) {
        await selectWorkerInScreenshots(filterData.workerName);
      }
      
      // Filter butonuna tıkla
      await clickScreenshotsFilterButton();
      
      // Storage'ı temizle
      await chrome.storage.local.remove(CONFIG.STORAGE_KEY);
      
      showNotification('Tarih filtreleri başarıyla ayarlandı!', 'success');
      
    } catch (error) {
      console.error('Robusta Helper: Screenshots sayfası hatası', error);
      showNotification('Filtre ayarlama hatası: ' + error.message, 'error');
    }
  }

  /**
   * DateRangePicker'a tarih aralığını set eder - GÖRÜNÜR ŞEKİLDE
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
      
      console.log('Robusta Helper: DateRange picker bulundu, görünür şekilde tarihler seçiliyor...');
      showNotification('DateRangePicker açılıyor...', 'info');
      
      // DateRangePicker'ı aç (input'a tıkla)
      dateInput.click();
      dateInput.focus();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // DateRangePicker'ın açıldığını kontrol et
      await waitFor(() => {
        const picker = document.querySelector('.daterangepicker.show-calendar');
        return picker && isElementVisible(picker);
      }, CONFIG.ELEMENT_WAIT_TIMEOUT);
      
      console.log('Robusta Helper: DateRangePicker açıldı, tarihler seçiliyor...');
      showNotification('Tarihler seçiliyor...', 'info');
      
      // Tarihleri parse et
      const startDateObj = parseDateString(startDate);
      const endDateObj = parseDateString(endDate);
      
      // Sol takvimde başlangıç tarihini seç
      await selectDateInCalendar('left', startDateObj);
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Bitiş tarihi aynı ay/yıl ise sol takvimde seç
      const isSameMonthYear =
        startDateObj.getFullYear() === endDateObj.getFullYear() &&
        startDateObj.getMonth() === endDateObj.getMonth();
      
      const endSide = isSameMonthYear ? 'left' : 'right';
      
      // Bitiş tarihini uygun takvimde seç
      await selectDateInCalendar(endSide, endDateObj);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Apply butonuna tıkla
      const applyBtn = document.querySelector(CONFIG.SELECTORS.DATERANGE_APPLY_BTN);
      if (applyBtn && isElementVisible(applyBtn)) {
        console.log('Robusta Helper: Apply butonuna tıklanıyor...');
        showNotification('Tarihler uygulanıyor...', 'info');
        applyBtn.click();
        
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        throw new Error('Apply butonu bulunamadı');
      }
      
    } catch (error) {
      console.error('Robusta Helper: DateRangePicker doldurma hatası', error);
      showNotification('Tarih seçimi hatası: ' + error.message, 'error');
      throw error;
    }
  }
  
  /**
   * DateRangePicker'da belirli bir takvimde tarih seçer (görünür şekilde)
   * @param {string} side - 'left' veya 'right'
   * @param {Date} dateObj - Seçilecek tarih objesi
   */
  async function selectDateInCalendar(side, dateObj) {
    const calendar = document.querySelector(`.drp-calendar.${side}`);
    
    if (!calendar) {
      throw new Error(`${side} takvim bulunamadı`);
    }
    
    const year = dateObj.getFullYear();
    const month = dateObj.getMonth(); // 0-11
    const day = dateObj.getDate();
    const hour = dateObj.getHours();
    const minute = dateObj.getMinutes();
    const second = dateObj.getSeconds();
    
    console.log(`Robusta Helper: ${side} takvimde ${year}-${month+1}-${day} ${hour}:${minute}:${second} seçiliyor...`);
    
    // 1. Yıl seçimi
    const yearSelect = calendar.querySelector('select.yearselect');
    if (yearSelect) {
      yearSelect.value = year.toString();
      yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 2. Ay seçimi
    const monthSelect = calendar.querySelector('select.monthselect');
    if (monthSelect) {
      monthSelect.value = month.toString();
      monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // 3. Gün seçimi - doğru günü bul ve tıkla
    await waitFor(() => findDayCell(calendar, day), 2000).catch(() => {});
    const dayCell = findDayCell(calendar, day);
    if (dayCell) {
      dayCell.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      console.log(`Robusta Helper: ${day}. gün tıklandı`);
    } else {
      console.warn(`Robusta Helper: ${day}. gün bulunamadı`);
    }
    
    // 4. Saat seçimi
    const hourSelect = calendar.querySelector('select.hourselect');
    if (hourSelect) {
      hourSelect.value = hour.toString();
      hourSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 5. Dakika seçimi
    const minuteSelect = calendar.querySelector('select.minuteselect');
    if (minuteSelect) {
      minuteSelect.value = minute.toString();
      minuteSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 6. Saniye seçimi
    const secondSelect = calendar.querySelector('select.secondselect');
    if (secondSelect) {
      secondSelect.value = second.toString();
      secondSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Robusta Helper: ${side} takvimde seçim tamamlandı`);
  }
  
  /**
   * Takvimde belirli bir günü içeren hücreyi bulur
   * @param {HTMLElement} calendar - Takvim elementi
   * @param {number} day - Gün (1-31)
   * @returns {HTMLElement|null} - Gün hücresi
   */
  function findDayCell(calendar, day) {
    const dayCells = calendar.querySelectorAll('td.available');
    
    for (const cell of dayCells) {
      const text = cell.textContent.trim();
      // "off" classı olmayanları tercih et (mevcut ayın günleri)
      if (text === day.toString() && !cell.classList.contains('off')) {
        return cell;
      }
    }
    
    // Bulunamazsa off olanları da kontrol et
    for (const cell of dayCells) {
      const text = cell.textContent.trim();
      if (text === day.toString()) {
        return cell;
      }
    }
    
    return null;
  }

  /**
   * Tarih stringini Date objesine çevirir
   * @param {string} dateStr - "YYYY-MM-DD HH:mm" formatında
   * @returns {Date}
   */
  function parseDateString(dateStr) {
    if (!dateStr) return new Date(NaN);
    const [datePart, timePart = '00:00:00'] = dateStr.trim().split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour = 0, minute = 0, second = 0] = timePart.split(':').map(Number);
    return new Date(year, (month || 1) - 1, day || 1, hour, minute, second, 0);
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
   * Screenshots sayfasında robot (worker) seçer
   * @param {string} workerName - Seçilecek robot adı
   */
  async function selectWorkerInScreenshots(workerName) {
    try {
      console.log(`Robusta Helper: Robot seçiliyor: ${workerName}`);
      showNotification(`Robot seçiliyor: ${workerName}`, 'info');
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const workerSelect = document.querySelector(CONFIG.SELECTORS.SCREENSHOTS_WORKER_SELECT);
      
      if (!workerSelect) {
        console.warn('Robusta Helper: Robot select elementi bulunamadı');
        return;
      }
      
      // Option'ları tara ve eşleşeni bul
      const options = workerSelect.querySelectorAll('option');
      let foundIndex = -1;
      
      for (let i = 0; i < options.length; i++) {
        const optionText = options[i].textContent.trim();
        if (optionText === workerName) {
          foundIndex = i;
          break;
        }
      }
      
      if (foundIndex >= 0) {
        // Seçimi yap
        workerSelect.selectedIndex = foundIndex;
        workerSelect.value = options[foundIndex].value;
        
        // Events tetikle
        workerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        workerSelect.dispatchEvent(new Event('input', { bubbles: true }));
        
        // AngularJS scope güncelle
        try {
          const scope = window.angular?.element(workerSelect)?.scope();
          if (scope) {
            scope.$apply(() => {
              scope.screenshottingModel = scope.enabledWorkers[foundIndex - 1]; // İlk option boş olduğu için -1
            });
          }
        } catch (e) {
          console.log('Robusta Helper: AngularJS scope güncelleme alternatif yol denendi');
        }
        
        console.log(`Robusta Helper: Robot seçildi: ${workerName}`);
        showNotification(`Robot seçildi: ${workerName}`, 'success');
      } else {
        console.warn(`Robusta Helper: Robot bulunamadı: ${workerName}`);
        showNotification(`Robot bulunamadı: ${workerName}`, 'error');
      }
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.error('Robusta Helper: Robot seçimi hatası', error);
    }
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
   * Kullanım: window.robustaSetScreenshotDates("2026-02-16 10:00", "2026-02-16 10:05")
   */
  window.robustaSetScreenshotDates = async function(startDate, endDate) {
    console.log('Robusta Helper: Manuel tarih set etme başlatıldı (görünür mod)');
    try {
      await fillDateRangePicker(startDate, endDate);
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
