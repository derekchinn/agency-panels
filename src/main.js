define(['jquery'], function ($) {
    'use strict';

    var AgencyPanels = function (opts) {
        // Private vars
        this._$panels;
        this._$prevPanel;
        this._$currentPanel;
        this._currentPanelIdx = 0;
        this._$visualTimerEl;
        this._debounceTimerId = null;
        this._advanceTimerId = null;
        this._timerIntervals = [];
        this._numCycles = 0;
        this._css = new AgencyPanels.css();
        this._stylesheetName = 'main.css';

        // Public vars
        opts = opts || {};
        this.$el = this._setEl(opts.el);
        this.autoAdvance = opts.autoAdvance === false ? false : true;
        this.advanceInterval = opts.advanceInterval || 10000;
        this.refreshCycle = opts.refreshCycle || 0;
        this.visualTimer = opts.visualTimer === false ? false : true;
        this.transitionInClass = opts.transitionInClass || this._css.fadeInClass;
        this.transitionOutClass = opts.transitionOutClass || this._css.fadeOutClass;

        // And go.
        this._init();
    };
    AgencyPanels.prototype.panelSelector = '.panel';
    AgencyPanels.prototype.panelContentSelector = '.panel-content';

    AgencyPanels.prototype.elClass = 'panels-container';
    AgencyPanels.prototype.visualTimerWrapperClass = 'visual-timer-wrapper';
    AgencyPanels.prototype.visualTimerClass = 'visual-timer';

    AgencyPanels.css = function () {};
    AgencyPanels.css.prototype.fadeInClass = 'fade-in';
    AgencyPanels.css.prototype.fadeOutClass = 'fade-out';
    AgencyPanels.css.prototype.growRightClass = 'grow-right';

    /**
     * Set the $el var so we can reference it and use it to
     * perform the necessary operations. Requires an actual DOM
     * element.. otherwise it goes kablooie.
     *
     * @param el HTML DOM Element
     **/
    AgencyPanels.prototype._setEl = function (el) {
        var $el = el.jquery ? el : $(el);
        $el.addClass(this.elClass);

        return $el;
    };

    /**
     * Wrapper function for the autoFit that adds the
     * debouncing capabilities. You shouldn't ever
     * need to call this manually.
     **/
    AgencyPanels.prototype.handleResize = function () {
        var fn = function () {
            this._autoFit();
        };
        this._debounce(fn.bind(this));
    };

    /**
     * Internal function that actually resizes the panels
     * according to the window height, such that the content is
     * auto centered vertically.
     **/
    AgencyPanels.prototype._autoFit = function () {
        var innerHeight = this._getScreenDimensions().height;

        // This allows for clipping in case content goes beyond the screen height
        this.$el.css('height', innerHeight);

        // This is for the individual panes so that we can float content in the middle
        for (var i = this._$panels.length - 1; i >= 0; i--) {
            this._$panels.eq(i).css('height', innerHeight);
        }
    };

    /**
     * A function to get the dimensions of the screen
     **/
    AgencyPanels.prototype._getScreenDimensions = function () {
        return {height: window.innerHeight, width: window.innerWidth};
    };

    /**
     * Handler to facilitate the hokey pushes. Debounces it so people
     * can't go crazy on button mashing.
     **/
    AgencyPanels.prototype.handleHotkey = function (evt) {
        var fn = function () {
            this._hotkeyHandler.call(this, evt);
        }

        this._debounce(fn.bind(this), 300);
    }

    AgencyPanels.prototype._hotkeyHandler = function (evt) {
        // Right Arrow
        if (evt.which == 39) {
            this.next()
        }
        
        // Left Arrow
        else if (evt.which == 37) {
            this.prev();
        }

        // 's' key
        else if (evt.which == 83) {
            if (this._advanceTimerId === null) {
                this.resume();
            }
            else {
                this.stop();
            }
        }  
    };

    /**
     * Initializes stuff
     **/
    AgencyPanels.prototype._init = function () {
        /*
        If someone sets the auto-advance to "false", we should never have a visual timer
        even if they decided to pass "true" to have the timer on. So let's put a safe-gaurd
        in place.
        */
        if (!this.autoAdvance && this.visualTimer) {
            this.visualTimer = false;
        }

        // Find all panels and set starting point
        this._$panels = this.$el.find(this.panelSelector);
        this._$currentPanel = this._$panels.eq(0);
        
        // Auto advance?
        if (this.autoAdvance) {
            // Find and store all the timers.. or use the default interval
            for (var i = 0, len = this._$panels.length; i < len; i ++) {
                var interval = this._$panels.eq(i).data('interval') || this.advanceInterval;
                this._timerIntervals.push(interval);
            }

            // Build progress bar only if auto-advance is on.. cuz it doesn't
            // make sense to have it when you manually are paging through it
            if (this.visualTimer) {
                this._buildVisualTimer();
            }

            this._start();
        }

        // Initial autofit and then set an event
        // handler on window resize if needed.
        this.handleResize();
        $(window).resize(this.handleResize.bind(this));

        // Listen for hotkeys
        $(window).keyup(this.handleHotkey.bind(this));

        // Animation event handler - unfortunately this only works for IE10 and up
        this.$el.on('animationstart webkitAnimationStart oanimationstart MSAnimationEStart', this._animationStartHandler.bind(this));
        this.$el.on('animationend webkitAnimationEnd oanimationend MSAnimationEnd', this._animationEndHandler.bind(this));

        // Attach an event to evaluate whether we need to reload or not
        if (this.refreshCycle) {
            this.$el.on('transitionEnter.panels', this._reloadMaybe.bind(this));
        }

        this._$currentPanel.addClass(this.transitionInClass).css('display', 'table');
    };

    /**
     * Public method that will display the next panel in the cycle. In
     * the event we're at the end of the panels list, it'll wrap and
     * make us go to the beginning.
     */
    AgencyPanels.prototype.next = function () {
        var idx = this._currentPanelIdx;
        return ++idx < this._$panels.length ? this._goTo(idx) : this._goTo(0);
    };

    /**
     * Public method that will display the previous panel in the cycle. In
     * the event we're at the beginning of the panels list, it'll wrap and
     * make us go to the end of the list.
     */
    AgencyPanels.prototype.prev = function () {
        var idx = this._currentPanelIdx;
        return --idx > -1 ? this._goTo(idx) : this._goTo(this._$panels.length - 1);
    };

    /**
     * Public method that sanitizes the input and which panel
     * we want to display.
     **/
    AgencyPanels.prototype.goTo = function (panelIndex) {
        // Clamp the values to a 1-N range so we don't get an out
        // of bounds error.
        var numPanels = this._$panels.length;
        if (panelIndex < 1) {
            panelIndex = 1;
        }
        else if (panelIndex > numPanels) {
            panelIndex = numPanels;
        }

        return this._goTo(panelIndex - 1);
    };

    /**
     * Method that kicks off the panel swapping process. It'll perform the internal
     * bookkeeping and then leave the rest of the animation effects up to the animation
     * event handlers.
     *
     * @param panelIndex Integer The panel index you want to go to (so future, not current)
     */
    AgencyPanels.prototype._goTo = function (panelIndex) {
        panelIndex = parseInt(panelIndex, 10);
        if (this.refreshCycle && panelIndex == this._$panels.length - 1) {
            this._numCycles++;
        }

        // In case someone hits next a lot, we'll need to cancel the previous
        // timeout before we set a new one.
        if (this._advanceTimerId) {
            clearTimeout(this._advanceTimerId);
            this._advanceTimerId = null;
        }

        // Fade out current
        this._$currentPanel.addClass(this.transitionOutClass);

        // Book keeping
        this._$prevPanel = this._$currentPanel;
        this._$currentPanel = this._$panels.eq(panelIndex);
        this._currentPanelIdx = this._$panels.index(this._$currentPanel);

        return this;
    };

    /**
     * The method that's called when an animation event ENDS. It takes care
     * of updating the visual elements and transitions of panels and the timer.
     * Additionally, it sets up the next iteration for the panel rotation.
     *
     * @param evt Event Object The normal data passed to event handlers
     **/
    AgencyPanels.prototype._animationEndHandler = function (evt) {
        var animationName = evt.originalEvent.animationName;

        if (animationName == this.transitionOutClass) {
            // Stop the timer bar so we can replay the animation
            if (this.visualTimer) {
                this._stopVisualTimer();
            }

            // Do your normal transitiony stuff
            this._$prevPanel.hide().removeClass(this.transitionInClass + ' ' + this.transitionOutClass);
            this._$currentPanel.css('display', 'table').addClass(this.transitionInClass);

            // Make sure it auto-advances accordingly
            if (this.autoAdvance) {
                this._advanceTimerId = setTimeout(this.next.bind(this), this._timerIntervals[this._currentPanelIdx]);
            }
        }

        if (animationName == this.transitionInClass) {
            // Make bar do some movin
            if (this.visualTimer) {
                this._startVisualTimer();
            }
        }
    };

    /**
     * This method is called when an animation event BEGINS and at the very least
     * transmits when the transition begins.
     *
     * @param evt Event Object The normal data passed to event handlers
     **/
    AgencyPanels.prototype._animationStartHandler = function (evt) {
        var animationName = evt.originalEvent.animationName;

        if (animationName == this.transitionInClass) {
            // Panel index is 0 based
            this.$el.trigger('transitionEnter.panels', [this._currentPanelIdx]);
        }

        if (animationName == this.transitionOutClass) {
            // At this point, the current panel index has already been incremented,
            // so we'll need to do some logic to make get the previous panel index.
            var prevPanelIdx = (this._currentPanelIdx - 1 > -1 ? this._currentPanelIdx : this._$panels.length) - 1;

            // Panel index is 0 based
            this.$el.trigger('transitionExit.panels', [prevPanelIdx]);
        }
    };

    /**
     *  Method to start the panel advancement
     **/
    AgencyPanels.prototype._start = function (withoutTransition) {
        // In case resume is called in succession, we'll
        // need to cancel the previous interval (if there is one)
        if (this._advanceTimerId) {
           this.stop(); 
        }

        this._advanceTimerId = setTimeout(this.next.bind(this), this._timerIntervals[this._currentPanelIdx]);

        if (this.visualTimer) {
            this._startVisualTimer(withoutTransition);
        }

        return this;
    };

    /**
     * Resume the panel advancement
     **/
    AgencyPanels.prototype.resume = function () {
        return this._start(true);
    };

    /**
     *  Method to stop the panel advancement
     **/
    AgencyPanels.prototype.stop = function () {
        if (this._advanceTimerId) {
            clearTimeout(this._advanceTimerId);
            this._advanceTimerId = null;
        }

        if (this.visualTimer) {
            this._stopVisualTimer();
        }

        return this;
    };

    /**
     * Debounces events so that we don't get crazy amounts
     * of function calls... for example, on the resize event
     **/
    AgencyPanels.prototype._debounce = function (func, delay) {
        delay = delay || 200;
        var fn = function () {
            this._debounceTimerId = null;
            func();
        };

        if (!this._debounceTimerId) {
            this._debounceTimerId = setTimeout(fn.bind(this), delay);
            return;
        }

        clearTimeout(this._debounceTimerId);
        this._debounceTimerId = setTimeout(fn.bind(this), delay);
    };

    /**
     * This gets called on every cycle completion. If the right conditions
     * exist, it'll comply and reload - right conditions being if the number
     * of cycles it's completed is equal to the number of cycles someone's
     * set to reload on.
     **/
    AgencyPanels.prototype._reloadMaybe = function (evt, panelIndex) {
        if (this._numCycles == this.refreshCycle && !panelIndex) {
            // Technically we can reset numCycles to 0.. but it shouldn't
            // really matter since we're refreshing...

            // Pause the animation so the reload doesn't make it look jank..
            this._setAnimationState(this._$panels.eq(panelIndex), 'paused');

            location.reload();
        }
    };

    /**
     * Helper function that sets the state of a CSS animation. It'll try
     * the default animation state.. but if that's not there, it'll try
     * the other method names.
     **/
    AgencyPanels.prototype._setAnimationState = function ($el, state) {
        if (!$el.css('animationPlayState', state)) {
            $el.css('webkitAnimationPlayState', state);
        }
    };

    // TODO: Break the visual timer code out into it's on module

    /**
     * Builds the timer bar on the bottom and it inserts it as a peer of the
     * panel-container element.
     **/
    AgencyPanels.prototype._buildVisualTimer = function () {
        this._$visualTimerEl = $('<div class="' + this.visualTimerWrapperClass + '"></div>')
        var $visualTimer =  $('<div class="' + this.visualTimerClass + '"></div>');
                
        this._$visualTimerEl.css('height', 0.008 * this._getScreenDimensions().height + 'px');
        this._$visualTimerEl.append($visualTimer);
        this.$el.after(this._$visualTimerEl);
    };

    /**
     * Start the visual timer's animation.
     *
     * @param withoutTransition Boolean a flag that tells the timer to take into account
     *        intro transition animation
     **/
    AgencyPanels.prototype._startVisualTimer = function (withoutTransition) {
        var $visualTimer = this._$visualTimerEl.find('.' + this.visualTimerClass);
        var duration = this._calcAnimationDuration(withoutTransition) + 's';

        $visualTimer.addClass(this._css.growRightClass);
        this._addCssWithPrefixes($visualTimer, 'animation-duration', duration);
    };

    /**
     * Stop the timer animation.
     **/
    AgencyPanels.prototype._stopVisualTimer = function () {
        var $visualTimer = this._$visualTimerEl.find('.' + this.visualTimerClass);
        $visualTimer.removeClass(this._css.growRightClass)
    };

    /**
     * Helper method to add the CSS properties.. but with all the vender
     * prefixes.
     **/
    AgencyPanels.prototype._addCssWithPrefixes = function ($el, prop, val) {
        var prefixes = ['-webkit-', '-moz-', '-o-']
        for (var i = prefixes.length; i > -1; i--) {
            $el.css(prefixes[i] + prop, val);
        }
        $el.css(prop, val);
    };

    /**
     * A method to claculate how long the visual timer bar's animation should run. It calculates this
     * value by adding together the duration of the intro and outro animations and subtracting it from
     * the total duration to spend on the panel.
     **/
    AgencyPanels.prototype._calcAnimationDuration = function (withoutTransition) {
        var transDuration = withoutTransition ? 0 : parseInt(this._getCssVal(this.transitionOutClass, 'animation-duration').replace(/s|ms/g, ''));
        var advDuration = this._timerIntervals[this._currentPanelIdx] / 1000;

        return advDuration - transDuration;
    };

    /**
     * A helper method to parse through the CSS rules and return the value of it according to the master
     * CSS stylesheets on the page. This also helps you find values that have vendor prefixes auto-
     * magically. This is particularly useful for finding values that don't have accessor values.. like
     * animations.
     *
     * @param cssClass String A CSS class to search for - e.g. fadeIn
     * @param prop String The property to search for for that css class - e.g. animation-duration
     **/
    AgencyPanels.prototype._getCssVal = function (cssClass, prop) {
        var css = document.styleSheets;

        for (var i = 0, len = css.length; i < len; i++) {
            if (css[i].href.search(this._stylesheetName) > -1) {
                var rules = css[i].cssRules || css[i].rules;

                for (var j = 0, rules_len = rules.length; j < rules_len; j++) {
                    if (rules[j] instanceof CSSStyleRule) {
                        if (rules[j].selectorText == '.' + cssClass) {
                            var ccProp = prop.toLowerCase().replace(/-(.)/g, function (match, $1) {
                                return $1.toUpperCase();
                            });

                            if (rules[j].style[ccProp]) {
                                return rules[j].style[ccProp];
                            }

                            // Otherwise we gotta do vendor prefixes
                            ccProp = ccProp.replace(ccProp[0], ccProp[0].toUpperCase());

                            return rules[j].style['webkit' + ccProp] ||
                                   rules[j].style['moz' + ccProp] ||
                                   rules[j].style['o' + ccProp] ||
                                   rules[j].style['ms' + ccProp];
                        }
                    }
                }
            }
        } 
    };

    return AgencyPanels;
});