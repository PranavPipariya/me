(function () {
    var input = document.getElementById('cmd-input');
    var responseBox = document.getElementById('cmd-response');
    var cmdItems = Array.prototype.slice.call(document.querySelectorAll('[data-cmd-item]'));
    var cmdTriggers = Array.prototype.slice.call(document.querySelectorAll('[data-cmd-trigger]'));
    var emptyState = document.getElementById('cmd-empty');
    var activeIndex = 0;

    function visibleItems() {
        return cmdItems.filter(function (item) {
            return !item.hidden;
        });
    }

    function setActive(index) {
        var visible = visibleItems();

        cmdItems.forEach(function (item) {
            item.classList.remove('is-active');
        });

        if (!visible.length) {
            activeIndex = 0;
            return;
        }

        if (index < 0) {
            index = visible.length - 1;
        }
        if (index >= visible.length) {
            index = 0;
        }

        activeIndex = index;
        visible[activeIndex].classList.add('is-active');
    }

    function filterItems(query) {
        var normalized = (query || '').trim().toLowerCase();

        cmdItems.forEach(function (item) {
            var haystack = (item.dataset.search || '').toLowerCase();
            item.hidden = normalized && haystack.indexOf(normalized) === -1;
        });

        if (emptyState) {
            emptyState.hidden = visibleItems().length !== 0;
        }

        setActive(0);
    }

    function openLayer() {
        document.body.classList.add('cmd-active');
        if (input) {
            input.value = '';
            filterItems('');
            input.focus();
        }
    }

    function closeLayer() {
        document.body.classList.remove('cmd-active');
        if (input) {
            input.blur();
        }
    }

    document.addEventListener('keydown', function (event) {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            if (document.body.classList.contains('cmd-active')) {
                closeLayer();
            } else {
                openLayer();
            }
            return;
        }

        if (event.key === 'Escape') {
            closeLayer();
            return;
        }

        if (!document.body.classList.contains('cmd-active')) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive(activeIndex + 1);
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive(activeIndex - 1);
        }

        if (event.key === 'Enter') {
            var visible = visibleItems();
            if (visible.length) {
                event.preventDefault();
                window.location.href = visible[activeIndex].getAttribute('href');
            }
        }
    });

    cmdTriggers.forEach(function (trigger) {
        trigger.addEventListener('click', openLayer);
    });

    document.addEventListener('click', function (event) {
        if (
            document.body.classList.contains('cmd-active') &&
            !event.target.closest('#cmd-layer') &&
            !event.target.closest('[data-cmd-trigger]')
        ) {
            closeLayer();
        }
    });

    if (input) {
        input.addEventListener('input', function (event) {
            filterItems(event.target.value);
        });
    }

    if (responseBox) {
        filterItems('');
    }

    var avatarWrap = document.querySelector('.avatar-wrap');
    var avatar = document.querySelector('.avatar');

    if (avatarWrap && avatar) {
        avatarWrap.addEventListener('mousemove', function (event) {
            var rect = avatarWrap.getBoundingClientRect();
            var x = (event.clientX - rect.left) / rect.width - 0.5;
            var y = (event.clientY - rect.top) / rect.height - 0.5;
            avatar.style.transform =
                'scale(1.03) rotateY(' + (x * 8) + 'deg) rotateX(' + (-y * 8) + 'deg)';
        });

        avatarWrap.addEventListener('mouseleave', function () {
            avatar.style.transform = '';
        });
    }
})();
