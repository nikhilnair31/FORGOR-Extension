document.addEventListener('DOMContentLoaded', function() {
    let searchDebounceTimer;

    const searchInput = document.getElementById('searchInput');
    const responseContent = document.getElementById('responseContent');
    const userIcon = document.getElementById('userIcon');
    const userMenu = document.getElementById('userMenu');
    const usernameInput = document.getElementById('usernameInput');
    const saveUserBtn = document.getElementById('saveUserBtn');
    const status = document.getElementById('status');
    const modal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const closeModal = document.getElementById('closeModal');
    
    searchInput.addEventListener('input', searchDisplay);

    closeModal.addEventListener('click', () => {
        modal.style.display = 'none';
        modalImage.src = '';
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
            modalImage.src = '';
        }
    });
    
    userIcon.addEventListener('click', () => {
        const isMenuVisible = userMenu.style.display !== 'flex';
        userMenu.style.display = isMenuVisible ? 'flex' : 'none';
        status.style.display = 'none';
    });

    saveUserBtn.addEventListener('click', () => {
        const newUsername = usernameInput.value.trim();
        if (newUsername) {
            chrome.storage.local.set({ username: newUsername }, () => {
                userIcon.textContent = newUsername.charAt(0).toUpperCase();

                status.textContent = 'Username saved!';
                status.style.display = 'flex';
                setTimeout(() => {
                    status.textContent = '';
                    status.style.display = 'none';
                }, 2000);
            });
        }
    });

    chrome.runtime.onMessage.addListener(function(message) {
        if (message.type === 'SEARCH_RESULTS') {
            displayResponses(message.results);
        } 
        else if (message.type === 'SEARCH_ERROR') {
            responseContent.innerHTML = `<p class="no-responses">Search error: ${message.error}</p>`;
        }
    });

    chrome.storage.local.get(['notification'], function(result) {
        // Clear the badge text when the popup is opened
        chrome.action.setBadgeText({text: ''});
        
        // Check if there's a search text stored in local storage and set it in the input field
        getSearchText().then(searchText => {
            searchInput.value = searchText ? searchText : '';
        });

        // Check if there are any notifications to display
        if (result.notification) {
            displayResponses(result.notification);
        } 
        else {
            responseContent.innerHTML = '<p class="no-responses">No responses received yet.</p>';
        }
    });
    
    chrome.storage.local.get(['username'], function(result) {
        if (result.username) {
            userIcon.textContent = result.username.charAt(0).toUpperCase();
            usernameInput.value = result.username;
        } 
        else {
            userIcon.textContent = 'U';
        }
    });
    
    async function getSearchText() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['searchText'], function(result) {
                if (result.searchText) {
                    resolve(result.searchText);
                } else {
                    resolve(null);
                }
            });
        });
    }

    function displayResponses(responses) {
        responseContent.innerHTML = ''; // Clear existing content
    
        if (!Array.isArray(responses) || responses.length === 0) {
            responseContent.innerHTML = '<p class="no-responses">No results found.</p>';
            return;
        }
    
        let imagesLoaded = 0;
        const total = responses.filter(item => item.image_presigned_url).length;
    
        const checkAllLoaded = () => {
            if (imagesLoaded >= total) {
                document.querySelectorAll('.grid-item').forEach(item => {
                    item.style.opacity = '1';
                });
            }
        };
    
        responses.forEach(item => {
            const gridItem = document.createElement('div');
            gridItem.className = 'grid-item';
    
            const shimmer = document.createElement('div');
            shimmer.className = 'shimmer-wrapper';
            shimmer.innerHTML = `<div class="shimmer"></div>`;
            gridItem.appendChild(shimmer);
    
            if (item.image_presigned_url) {
                const img = new Image();
                img.src = item.image_presigned_url;
                
                img.onload = function () {
                    shimmer.remove();
                    img.style.opacity = '0'; // Start transparent
                    gridItem.insertBefore(img, gridItem.firstChild);
                
                    // Force a reflow to ensure transition applies
                    void img.offsetWidth;
                    img.style.opacity = '1'; // Fade in
                
                    imagesLoaded++;
                    checkAllLoaded();
                
                    // Show timestamp only if image is successfully loaded
                    if (item.timestamp_str) {
                        const timestamp = document.createElement('div');
                        timestamp.className = 'timestamp';
                        timestamp.textContent = item.timestamp_str;
                        gridItem.appendChild(timestamp);
                    }
                
                    if (item.image_text) {
                        const analysisText = document.createElement('div');
                        analysisText.className = 'analysis-text';
                        analysisText.textContent = item.image_text;
                        gridItem.appendChild(analysisText);
                    }

                    img.addEventListener('click', () => {
                        modalImage.src = img.src;
                        modal.style.display = 'flex';
                    });
                };
    
                img.onerror = function () {
                    shimmer.remove();
                    const broken = document.createElement('div');
                    broken.className = 'broken-image';
                    broken.textContent = 'Image not available';
                    gridItem.appendChild(broken);
    
                    if (item.image_text) {
                        const analysisText = document.createElement('div');
                        analysisText.className = 'analysis-text';
                        analysisText.textContent = item.image_text;
                        gridItem.appendChild(analysisText);
                    }
    
                    imagesLoaded++;
                    checkAllLoaded();
                };
            } else {
                shimmer.remove();
                const broken = document.createElement('div');
                broken.className = 'broken-image';
                broken.textContent = 'No image available';
                gridItem.appendChild(broken);
    
                if (item.image_text) {
                    const analysisText = document.createElement('div');
                    analysisText.className = 'analysis-text';
                    analysisText.textContent = item.image_text;
                    gridItem.appendChild(analysisText);
                }
            }
    
            responseContent.appendChild(gridItem);
        });
    }       
    
    function searchDisplay() {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            const query = this.value.trim();
            if (query) {
                searchResponses(query);
            } 
            else {
                // If the search bar is cleared, reload the initial notifications
                chrome.storage.local.get(['notification'], function(result) {
                });
            }
        }, 300); // Debounce for 300ms
    }
    function searchResponses(query) {
        responseContent.innerHTML = '';
    
        // Show shimmer placeholders (e.g. 6 grid shimmer items)
        for (let i = 0; i < 12; i++) {
            const placeholder = document.createElement('div');
            placeholder.className = 'grid-item';
    
            const shimmer = document.createElement('div');
            shimmer.className = 'shimmer-wrapper';
            shimmer.innerHTML = `<div class="shimmer"></div>`;
            placeholder.appendChild(shimmer);
    
            responseContent.appendChild(placeholder);
        }
    
        chrome.runtime.sendMessage({
            type: 'SEARCH_REQUEST',
            query: query,
            search: true
        });
    }
});