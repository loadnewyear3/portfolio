// Handles the hamburger menu toggle, external links, discography, and lightbox
document.addEventListener("DOMContentLoaded", function () {
    // Universal mobile breakpoint (px) — change this one value to control
    // when the hamburger and mobile layout apply site-wide.
    const MOBILE_BREAKPOINT = 1500;

    // Toggle an `is-mobile` class on the <html> element based on either
    // the viewport width OR the rendered width of a homepage tile.
    // This makes "mobile" mode trigger when tiles have shrunk below
    // a usable width (so the hamburger and stacked layout match tile size).
    (function setupMobileClass() {
        const root = document.documentElement;
        const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
        // When a card's width falls below this px value we consider the layout 'mobile'.
        const TILE_MIN_WIDTH = 300;

        function setMobile(on) {
            if (on) root.classList.add('is-mobile'); else root.classList.remove('is-mobile');
        }

        // Check tile width and media query
        function evaluate() {
            const byBreakpoint = mq.matches;
            let byTile = false;
            try {
                const grid = document.querySelector('.homepage-grid');
                const card = grid && grid.querySelector('.homepage-card');
                if (card) {
                    const w = card.getBoundingClientRect().width;
                    byTile = (w > 0 && w < TILE_MIN_WIDTH);
                }
            } catch (e) { /* ignore DOM access errors */ }

            setMobile(byBreakpoint || byTile);
        }

        // Debounce helper
        function debounce(fn, wait) {
            let t;
            return function () { clearTimeout(t); t = setTimeout(fn, wait); };
        }

        // Initial evaluation
        evaluate();

        // Watch viewport changes
        if (mq.addEventListener) mq.addEventListener('change', evaluate);
        else if (mq.addListener) mq.addListener(evaluate);

        // Watch grid/card size changes (preferred) and fallback to window resize
        const grid = document.querySelector('.homepage-grid');
        if (grid && window.ResizeObserver) {
            const ro = new ResizeObserver(debounce(evaluate, 80));
            ro.observe(grid);
        } else {
            window.addEventListener('resize', debounce(evaluate, 120));
        }
    })();
    // =========================================================================
    // 1. Navigation & UI (Hamburger, External Links, Copy Code)
    // =========================================================================
    const hamburger = document.querySelector('.hamburger');
    const nav = document.querySelector('.main-nav');
    const overlay = document.querySelector('.nav-overlay');

    hamburger.addEventListener('click', function () {
        hamburger.classList.toggle('is-active');
        nav.classList.toggle('open');
        overlay.classList.toggle('open');
        const expanded = hamburger.getAttribute('aria-expanded') === 'true';
        hamburger.setAttribute('aria-expanded', !expanded);
    });

    overlay.addEventListener('click', function () {
        nav.classList.remove('open');
        hamburger.classList.remove('is-active');
        overlay.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener("click", function(event) {
        const nav = document.querySelector('.main-nav');
        const hamburger = document.querySelector('.hamburger');
        const overlay = document.querySelector('.nav-overlay');
        const header = document.querySelector('.site-header');

        // Only run if menu is open
        if (nav.classList.contains('open')) {
            // If click is NOT inside nav, hamburger, or header
            if (
                !nav.contains(event.target) &&
                !hamburger.contains(event.target) &&
                !header.contains(event.target)
            ) {
                nav.classList.remove('open');
                hamburger.classList.remove('is-active');
                overlay.classList.remove('open');
                hamburger.setAttribute('aria-expanded', 'false');
            }
        }
    });

        // Open external links in a newtab, while keeping internal and subdomain links in the same tab
        // get current domain by striping www away from the hostname
        var myDomain = window.location.hostname.replace(/^www\./, '');
        
        // Open external links in a new tab
        document.querySelectorAll('a[href^="http"]').forEach(function(link) {
            var url;
            try {
                url = new URL(link.href);
            } catch (e) {
                return; // skip invalid URLs
            }
            // If the link's hostname ends with the current domain, treat as internal (including subdomains)
            if (!url.hostname.endsWith(myDomain)) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            } else {
                link.removeAttribute('target');
                link.removeAttribute('rel');
            }
        });

    // --- Copy to Clipboard for Code Blocks ---
    const preBlocks = document.querySelectorAll('.news-body pre');

    preBlocks.forEach(pre => {
        // Create the copy button
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-code-button';
        copyButton.type = 'button';
        copyButton.ariaLabel = 'Copy code to clipboard';
        copyButton.innerText = 'Copy';

        // Add the button to the <pre> block
        pre.appendChild(copyButton);

        // Add click event listener
        copyButton.addEventListener('click', () => {
            const code = pre.querySelector('code');
            if (code) {
                navigator.clipboard.writeText(code.innerText).then(() => {
                    // Provide visual feedback
                    copyButton.innerText = 'Copied!';
                    copyButton.classList.add('copied');

                    // Reset the button text after 2 seconds
                    setTimeout(() => {
                        copyButton.innerText = 'Copy';
                        copyButton.classList.remove('copied');
                    }, 2000);
                });
            }
        });
    });

    // =========================================================================
    // 2. Discography Logic
    // =========================================================================
    initDiscography();

    // =========================================================================
    // 3. Photos Lightbox Logic
    // =========================================================================
    initLightbox();

    // =========================================================================
    // 4. On This Day Logic
    // =========================================================================
    initOnThisDay();
});

// --- Discography Helper Functions ---

function initDiscography() {
    const filterContainer = document.getElementById('filter-buttons');
    const discographyGrid = document.getElementById('discography-grid');

    // If the necessary elements aren't on the page (e.g., not the discography page), do nothing.
    if (!discographyGrid || !filterContainer) {
        // Log an error only if one is missing but not the other, which might indicate a typo.
        if (discographyGrid || filterContainer) {
             console.error("Discography script requires both 'discography-grid' and 'filter-buttons' elements to be present.");
        }
        return;
    }

    let discographyData = [];
    try {
        // Attempt to parse the JSON data from the `data-discography` attribute.
        discographyData = JSON.parse(discographyGrid.dataset.discography);
    } catch (e) {
        console.error("CRITICAL ERROR: Could not parse discography data from the data-discography attribute. Please ensure the JSON is valid and properly escaped in your HTML.", e);
        discographyGrid.innerHTML = `<p>Error: Discography data is malformed or missing.</p>`;
        return; // Stop execution if data is unparseable.
    }

    if (!discographyData || discographyData.length === 0) {
        console.warn("WARNING: Discography data is available but empty, or parsing resulted in an empty array.");
        discographyGrid.innerHTML = `<p>No discography items found.</p>`;
        return;
    }

    // Define the placeholder image path. This MUST match the one in fetch-discography.js
    const PLACEHOLDER_IMG_PATH = '/images/placeholders/no-cover-art.jpg';

    // Define month names here so it's initialized before any function that uses it is called.
    const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    try {
        // Get unique categories from the data, sort them, and ensure "All" is first.
        const uniqueCategories = [...new Set(discographyData.map(item => item.category))];
        uniqueCategories.sort(); // Sorts alphabetically
        const categories = ['All', ...uniqueCategories];

        // Create and display the filter buttons
        displayFilterButtons(categories, filterContainer);

        // Display all items by default
        displayDiscographyItems(discographyData, 'All', discographyGrid, PLACEHOLDER_IMG_PATH, monthNames);

        // Add event listeners to the filter buttons
        const buttons = document.querySelectorAll('.filter-btn');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                // Set the clicked button as active
                buttons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                // Filter and display items based on the selected category
                const category = button.dataset.category;
                displayDiscographyItems(discographyData, category, discographyGrid, PLACEHOLDER_IMG_PATH, monthNames);
            });
        });
    } catch (error) {
        console.error("CRITICAL ERROR: An error occurred during the discography display process. This might indicate an issue with the data structure or rendering logic.", error);
        discographyGrid.innerHTML = `<p>Error displaying discography. please check console log in developer tools for details.</p>`;
    }
}

function slugify(text) {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')           // Replace spaces with -
        .replace(/[^\w-]+/g, '')       // Remove all non-word chars
        .replace(/--+/g, '-')          // Replace multiple - with single -
        .replace(/^-+/, '')            // Trim - from start of text
        .replace(/-+$/, '');           // Trim - from end of text
}

function displayFilterButtons(categories, container) {
    container.innerHTML = categories.map((category, index) => `
        <button class="action-button filter-btn ${index === 0 ? 'active' : ''}" data-category="${category}">
            ${category}
        </button>
    `).join('');
}

function getDaySuffix(day) {
    if (day > 3 && day < 21) return 'th'; // Handles 11th, 12th, 13th
    switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
    }
}

function formatDate(item, monthNames) {
    // Use release_date if available and valid in iso8601 format (e.g., "YYYY", "YYYY-MM", "YYYY-MM-DD")
    if (item.release_date && item.release_date.match(/^\d{4}(-\d{2}){0,2}$/)) {
        const parts = item.release_date.split('-');
        const year = parts[0];
        const month = parts.length > 1 ? parseInt(parts[1], 10) : null;
        const day = parts.length > 2 ? parseInt(parts[2], 10) : null;

        if (day && month && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const monthName = monthNames[month];
            return `${day}${getDaySuffix(day)} of ${monthName} ${year}`;
        } else if (month && month >= 1 && month <= 12) {
            const monthName = monthNames[month];
            return `${monthName} ${year}`;
        }
        return `${year}`; // Fallback to just year if only year is present in release_date string
    } else if (item.year && item.year !== 'N/A') { // Fallback to 'year' property if release_date is missing or malformed
        return `${item.year}`;
    }
    return ''; // No date information available
}

function displayDiscographyItems(allItems, category, grid, placeholderPath, monthNames) {
    const filteredItems = category === 'All'
        ? allItems
        : allItems.filter(item => item.category === category);

    if (filteredItems.length === 0) {
        grid.innerHTML = '<p>No releases found in this category.</p>';
        return;
    }

    grid.innerHTML = filteredItems.map(item => {
        // Format the date for the current item
        const formattedDate = formatDate(item, monthNames);
        // Combine the date and category into a single line, handling cases where one might be missing
        const infoLine = [formattedDate, item.category].filter(Boolean).join(' &bull; ');

        // Determine the URL for the item based on its category and title
        const categorySlug = slugify(item.category);
        const titleSlug = slugify(item.title);
        const itemUrl = `/discography/${categorySlug}/${titleSlug}/`;

        if (item.cover_art && item.cover_art.trim() !== '' && item.cover_art !== placeholderPath) {
            // Item WITH cover art
            return `
                <a href="${itemUrl}" class="discography-item" data-category="${item.category}">
                    <div class="discography-item-image-wrapper">
                        <img src="${item.cover_art}" alt="Cover art for ${item.title}">
                    </div>
                    <div class="discography-item-info">
                        <h3>${item.title}</h3>
                        ${infoLine ? `<p>${infoLine}</p>` : ''}
                    </div>
                </a>
            `;
        } else {
            // Item WITHOUT cover art (placeholder)
            return `
                <a href="${itemUrl}" class="discography-item placeholder" data-category="${item.category}">
                    <h3>${item.title}</h3>
                    ${infoLine ? `<p>${infoLine}</p>` : ''}
                </div>
            `;
        }
    }).join('');
}

// --- Lightbox Helper Functions ---

function initLightbox() {
    const lightboxTriggers = document.querySelectorAll('.lightbox-trigger');
    const lightboxOverlay = document.getElementById('lightbox-overlay');

    if (!lightboxOverlay || lightboxTriggers.length === 0) return;

    const lightboxImage = document.getElementById('lightbox-image');
    const closeBtn = document.getElementById('lightbox-close');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');

    if (!lightboxImage || !closeBtn || !prevBtn || !nextBtn) return;

    const images = Array.from(lightboxTriggers).map(trigger => trigger.href);
    let currentIndex = 0;

    function showImage(index) {
        if (index < 0 || index >= images.length) return;
        currentIndex = index;
        lightboxImage.src = images[currentIndex];
        prevBtn.style.display = (currentIndex > 0) ? 'block' : 'none';
        nextBtn.style.display = (currentIndex < images.length - 1) ? 'block' : 'none';
    }

    function openLightbox(e) {
        e.preventDefault();
        const index = parseInt(e.currentTarget.dataset.index, 10);
        showImage(index);
        lightboxOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightboxOverlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    function showPrevImage() { showImage(currentIndex - 1); }
    function showNextImage() { showImage(currentIndex + 1); }

    function handleKeydown(e) {
        if (!lightboxOverlay.classList.contains('active')) return;
        switch (e.key) {
            case 'ArrowLeft': showPrevImage(); break;
            case 'ArrowRight': showNextImage(); break;
            case 'Escape': closeLightbox(); break;
        }
    }

    let touchstartX = 0;
    let touchendX = 0;

    function handleSwipe() {
        const swipeThreshold = 50;
        if (touchendX < touchstartX - swipeThreshold) showNextImage();
        if (touchendX > touchstartX + swipeThreshold) showPrevImage();
    }

    lightboxOverlay.addEventListener('touchstart', e => {
        if (e.target === prevBtn || e.target === nextBtn || e.target === closeBtn) return;
        touchstartX = e.changedTouches[0].screenX;
    }, { passive: true });

    lightboxOverlay.addEventListener('touchend', e => {
        if (e.target === prevBtn || e.target === nextBtn || e.target === closeBtn) return;
        touchendX = e.changedTouches[0].screenX;
        handleSwipe();
    });

    lightboxTriggers.forEach(trigger => {
        trigger.addEventListener('click', openLightbox);
    });

    closeBtn.addEventListener('click', closeLightbox);
    prevBtn.addEventListener('click', showPrevImage);
    nextBtn.addEventListener('click', showNextImage);
    document.addEventListener('keydown', handleKeydown);

    lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) closeLightbox();
    });
}

// --- On This Day Helper Functions ---

function initOnThisDay() {
    const container = document.getElementById('on-this-day-container');
    if (!container) return; // Element not present (e.g. not on homepage)

    let discographyData = [];
    try {
        discographyData = JSON.parse(container.dataset.discography);
    } catch (e) {
        console.error("Error parsing discography data for On This Day", e);
        return;
    }

    let blogData = [];
    if (container.dataset.posts) {
        try {
            blogData = JSON.parse(container.dataset.posts);
            console.log(`On This Day Debug: Found ${blogData.length} blog posts`, blogData);
        } catch (e) { console.error("Error parsing blog data for On This Day", e); }
    } else {
        console.warn("On This Day Debug: No posts data attribute found");
    }

    let photoData = [];
    if (container.dataset.photos) {
        try {
            photoData = JSON.parse(container.dataset.photos);
            console.log(`On This Day Debug: Found ${photoData.length} photos`, photoData);
        } catch (e) { console.error("Error parsing photo data for On This Day", e); }
    } else {
        console.warn("On This Day Debug: No photos data attribute found");
    }

    // DEBUG: Hardcoded date enabled for preview/testing
    // Change the date below to test. Format: new Date(YYYY, MONTH-1, DAY) - Month is 0-indexed (0=Jan, 1=Feb, etc.)
    // Comment out the line below to use today's date instead
    //const today = new Date(2025, 2, 30); // Testing with a date at least one year after some sample data.
    const today = new Date(); // Current date (uncomment to use)
    
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    const currentYear = today.getFullYear();
    // console.log(`On This Day Debug: Simulating date ${today.toDateString()}`);

    const allItems = [...discographyData, ...blogData, ...photoData];

    // Filter for items released on this day (ignoring year)
    const matches = allItems.filter(item => {
        const dateStr = item.release_date || item.date;
        if (!dateStr) return false;
        // Expecting YYYY-MM-DD format
        const parts = dateStr.split('-');
        if (parts.length !== 3) return false;

        const rYear = parseInt(parts[0], 10);
        const rMonth = parseInt(parts[1], 10);
        const rDay = parseInt(parts[2], 10);

        return rMonth === currentMonth && rDay === currentDay && (currentYear - rYear >= 1);
    });

    console.log(`On This Day Debug: Found ${matches.length} matches.`);
    console.log(`On This Day Debug: Total items: ${allItems.length} (Discography: ${discographyData.length}, Blog: ${blogData.length}, Photos: ${photoData.length})`);
    if (matches.length > 0) {
        console.log(`On This Day Debug: Matched items:`, matches);
    }
    
    const PLACEHOLDER_IMG_PATH = '/images/placeholders/no-cover-art.jpg';

    // Populate the dedicated placeholder card on the homepage (duplicate of Latest News layout)
    const placeholderLink = document.getElementById('on-this-day-card-link');
    if (!placeholderLink) return; // placeholder not present

    if (matches.length === 0) {
        // Hide the placeholder if no matches found
        placeholderLink.style.display = 'none';
        return;
    }

    // Use the first match to populate the card (keeps layout identical to Latest News)
    const item = matches[0];
    const dateStr = item.release_date || item.date;
    const rYear = parseInt(dateStr.split('-')[0], 10);
    const yearsAgo = currentYear - rYear;
    const yearLabel = yearsAgo === 1 ? '1 Year Ago' : `${yearsAgo} Years Ago`;

    let itemUrl = '#';
    let metaHTML = '';
    let mediaHTML = '';

    if (item.type === 'blog') {
        itemUrl = item.link || '#';
        metaHTML = `<p class="card-meta">${item.title}<br>${rYear}</p>`;

        if (item.image && item.image.trim() !== '') {
            mediaHTML = `<div class="card-image-wrapper"><img src="${item.image}" alt="${item.title}" class="card-image" loading="lazy"></div>`;
        } else {
            mediaHTML = `<p style="margin: 1em 0;">${(item.summary || '').trim()}</p>`;
        }
    } else if (item.type === 'photo') {
        itemUrl = item.link || '#';
        metaHTML = `<p class="card-meta">${item.title}<br>${rYear}</p>`;

        if (item.image && item.image.trim() !== '') {
            mediaHTML = `<div class="card-image-wrapper"><img src="${item.image}" alt="${item.title}" class="card-image" loading="lazy"></div>`;
        } else {
            mediaHTML = `<p style="margin: 1em 0;">Photo gallery</p>`;
        }
    } else {
        const categorySlug = slugify(item.category);
        const titleSlug = slugify(item.title);
        itemUrl = `/discography/${categorySlug}/${titleSlug}/`;
        const img = (item.cover_art && item.cover_art.trim() !== '' && item.cover_art !== PLACEHOLDER_IMG_PATH) ? item.cover_art : PLACEHOLDER_IMG_PATH;

        // For remixes/edits, try to get the original artist from the tracklist
        let artistDisplay = 'Goldmaster';
        if (item.category === 'Remix' && item.tracklist && item.tracklist.length > 0) {
            const firstMedia = item.tracklist[0].media;
            if (firstMedia && firstMedia.length > 0 && firstMedia[0].tracks && firstMedia[0].tracks.length > 0) {
                const firstTrackArtist = firstMedia[0].tracks[0].artist;
                if (firstTrackArtist && firstTrackArtist.trim() !== '') {
                    artistDisplay = firstTrackArtist;
                }
            }
        }

        metaHTML = `<p class="card-meta">${item.title}<br>${artistDisplay}<br>${rYear}</p>`;
        mediaHTML = `<div class="card-image-wrapper"><img src="${img}" alt="${item.title}" class="card-image" loading="lazy"></div>`;
    }

    const cardContent = placeholderLink.querySelector('.card-content');
    if (!cardContent) return;

    const itemTypeLabel = item.type === 'blog' ? 'Post' : item.type === 'photo' ? 'Photo' : 'Release';
    cardContent.innerHTML = `
        <h4>${yearLabel}</h4>
        ${metaHTML}
        ${mediaHTML}
        <span class="card-link">View ${itemTypeLabel} &rarr;</span>
    `;

    // Update the link target so clicking goes to the item
    placeholderLink.setAttribute('href', itemUrl);
}