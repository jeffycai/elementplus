import 'ion-sound';
import {
    shell,
    remote as Remote,
    screen as Screen,
    nativeImage as NativeImage
}                         from 'electron';
import Path               from 'path';
import React              from 'react';
import ReactDOM           from 'react-dom';
import UUID               from 'uuid';
import Event              from './event-center';
import Config             from './config';
import Helper             from './utils/helper';
import R, {EVENT}         from './resource';
import User, {USER_STATUS}from './models/user';
import ReadyNotifier      from './models/ready-notifier';
import API          from './models/api';
import Socket             from './models/socket';
import DAO                from './models/dao';
import {ChatApp}          from './models/apps';
import AboutView          from './views/misc/about';
import ContactView        from './views/contacts/contact';
import ConfirmCloseWindow from './views/windows/confirm-close-window';
import Modal              from 'Components/modal';
import ImageView          from 'Components/image-view';
import Lang               from 'Lang';
import Theme              from 'Theme';
import takeScreenshot     from 'Utils/screenshot';

if(DEBUG && process.type !== 'renderer') {
    console.error('App must run in renderer process.');
}

const config         = new Config();
const Menu           = Remote.Menu;
const MenuItem       = Remote.MenuItem;
const Dialog         = Remote.dialog;
const BrowserWindow  = Remote.BrowserWindow;
const GlobalShortcut = Remote.globalShortcut;

/**
 * Application
 * 
 * Only for renderer process
 */
class App extends ReadyNotifier {

    /**
     * Application constructor
     */
    constructor() {
        super();

        this.event         = Event;
        this.ipc           = Event.ipc;
        this.config        = config;
        this.lang          = Lang;
        this.browserWindow = Remote.getCurrentWindow();
        this.desktopPath   = Remote.app.getPath('desktop');
        this.userDataPath  = Remote.app.getPath('userData');
        
        this.remote('appRoot').then(appRoot => {
            this.appRoot = appRoot;
        });

        config.ready(() => {
            this.resetUser(this.config.user);
            this._checkReady();
        });

        config.load(this.userDataPath);

        this.$ = {
            chat: new ChatApp(this)
        };

        Object.keys(this.$).forEach(appName => {
            return this[appName] = this.$[appName];
        });

        this._initEvents();

        if(window.ion) {
            window.ion.sound({
                sounds: [
                    {name: 'message'}
                ],
                multiplay: true,
                volume: 1,
                path: 'sound/',
                preload: true,
            });
            if(DEBUG) {
                console.groupCollapsed('%cSOUND inited', 'display: inline-block; font-size: 10px; color: #689F38; background: #CCFF90; border: 1px solid #CCFF90; padding: 1px 5px; border-radius: 2px;');
                console.log('ion', window.ion);
                console.groupEnd();
            }
        }
    }

    _checkReady() {
        if(this.config && this.config.isReady) {
            this.ready();
        }
    }

    /**
     * Initial function to init events
     * @return {void}
     */
    _initEvents() {
        this.on(R.event.ui_link, link => {
            if(link.action === 'URL') {
                shell.openExternal(link.target)
            } else if(link.action === 'Member' && link.target) {
                let member = this.dao.getMember(link.target);
                if(member) {
                    Modal.show({
                        content: () => {
                            return <ContactView onSendBtnClick={() => {
                                Modal.hide();
                            }} member={member}/>;
                        },
                        width: 500,
                        actions: false
                    });
                }
            }
        });

        this.on(R.event.database_rebuild, dbVersion => {
            Modal.show({
                modal: true,
                closeButton: false,
                content: this.lang.main.databaseUpdateTip,
                width: 360,
                actions: [{type: 'cancel', label: this.lang.common.later}, {type: 'submit', label: this.lang.main.reload}],
                onSubmit: () => {
                    this.reloadApp();
                }
            });
        });

        let onSocketChange = 

        this.on(R.event.socket_close, e => {
            this.user.changeStatus(this.user.isOnline ? USER_STATUS.disconnect : USER_STATUS.unverified, Lang.errors.SOCKET_CLOSE, 'socket_error');
        });
        this.on(R.event.socket_error, e => {
            this.user.changeStatus(this.user.isOnline ? USER_STATUS.disconnect : USER_STATUS.unverified, Lang.errors.SOCKET_ERROR, 'socket_error');
        });
        this.on(R.event.socket_timeout, e => {
            this.user.changeStatus(this.user.isOnline ? USER_STATUS.disconnect : USER_STATUS.unverified, Lang.errors.SOCKET_TIMEOUT, 'socket_error');
        });

        this.on(R.event.net_online, () => {
            if(this.user.isDisconnect) {
                this.emit(R.event.ui_messager, {
                    id: 'autoLoginingMessager',
                    clickAway: false,
                    autoHide: false,
                    content: Lang.login.autoLogining
                });
                this.login();
            }
        });

        this.on(R.event.net_offline, () => {
            if(this.user.isOnline) {
                this.user.changeStatus(USER_STATUS.disconnect, Lang.errors.NET_OFFLINE, 'net_offline');
                this.emit(R.event.ui_messager, {
                    clickAway: false,
                    autoHide: false,
                    content: Lang.errors.NET_OFFLINE,
                    color: Theme.color.negative
                });
            }
        });

        this.on(R.event.user_kickoff, e => {
            this.user.changeStatus(USER_STATUS.unverified, Lang.errors.KICKOFF, 'kickoff');
        });

        this.browserWindow.on('focus', () => {
            this.emit(R.event.ui_focus_main_window);
        });

        this.browserWindow.on('restore', () => {
            this.browserWindow.setSkipTaskbar(false);
            this.emit(R.event.ui_show_main_window);
        });

        this.browserWindow.on('minimize', () => {
            this.browserWindow.setSkipTaskbar(true);
            this.emit(R.event.ui_show_main_window);
        });

        this.event.ipc.on(R.event.app_main_window_close, () => {
            let userCloseOption = this.user.config.ui.onClose;
            const handleCloseOption = option => {
                if(!option) option = userCloseOption;
                if(option === 'minimize') {
                    this.browserWindow.minimize();
                } else {
                    this.browserWindow.hide();
                    if(DEBUG) console.error('WINDOW CLOSE...');
                    setTimeout(() => {
                        this.quit();
                    }, 2000);
                }
            };
            if(userCloseOption !== 'close' && userCloseOption !== 'minimize') {
                userCloseOption = '';
                Modal.show({
                    modal: true,
                    header: this.lang.main.askOnCloseWindow.title,
                    content: () => {
                        return <ConfirmCloseWindow onOptionChange={select => {
                            userCloseOption = select;
                        }}/>;
                    },
                    width: 400,
                    actions: [{type: 'cancel'}, {type: 'submit'}],
                    onSubmit: () => {
                        if(userCloseOption) {
                            if(userCloseOption.remember) {
                                this.user.config.ui.onClose = userCloseOption.option;
                                this.saveUser();
                            }
                            handleCloseOption(userCloseOption.option);
                        }
                    }
                });
                this.requestAttention(1);
            } else {
                handleCloseOption(userCloseOption);
            }
        });
    }

    /**
     * Bind event
     * @param  {String} event
     * @param  {Function} listener
     * @return {Symbol}
     */
    on(event, listener) {
        return this.event.on(event, listener);
    }

    /**
     * Bind once event
     */
    once(event, listener) {
        return this.event.once(event, listener);
    }

    /**
     * Unbind event by name
     * @param  {...[Symbol]} names
     * @return {Void}
     */
    off(...names) {
        this.event.off(...names);
    }

    /**
     * Emit event
     */
    emit(names, ...args) {
        this.event.emit(names, ...args);
    }

    /**
     * Get remote property or call remote methods
     */
    remote(method, ...args) {
        return new Promise((resolve, reject) => {
            let callBackEventName = EVENT.app_remote + '.' + Helper.guid;
            this.ipc.once(callBackEventName, (e, remoteResult) => {
                resolve(remoteResult);
            });
            this.ipc.send(EVENT.app_remote, method, callBackEventName, ...args);
        });
    }

    /**
     * Get current user
     */
    get user() {
        return this._user;
    }

    /**
     * Set current user
     */
    set user(user) {
        this.resetUser(user, true);
    }

    /**
     * Set current user with options
     */
    resetUser(user, saveConfig, notifyRemote) {
        const oldIdentify = this._user ? this._user.identify : null;

        if(!(user instanceof User)) {
            user = this.config.getUser(user);
        }
        if(this.saveUserTimerTask && this._user) {
            this.config.save(this._user);
        }

        user.listenStatus = true;
        this._user = user;

        if(oldIdentify !== user.identify) {
            this.emit(R.event.user_swap, user);
        }
        this.emit(EVENT.user_change, user);

        if(saveConfig) this.config.save(user);

        return user;
    }

    /**
     * Save user
     */
    saveUser(user) {
        if(user) {
            this.resetUser(user, true);
        } else {
            this.config.save(this.user);
        }
        if(this.saveUserTimerTask) {
            clearTimeout(this.saveUserTimerTask);
            this.saveUserTimerTask = null;
        }
    }

    /**
     * Delay save user config
     * @return {void}
     */
    delaySaveUser() {
        clearTimeout(this.saveUserTimerTask);
        this.saveUserTimerTask = null;
        if(this.user) {
            this.saveUserTimerTask = setTimeout(() => {
                this.saveUser();
            }, 5000);
        }
    }

    /**
     * Do user login action
     */
    login(user) {
        if(global.TEST) {
            if(!user) user = this.user;
            user = User.create(user);
            this.isUserLogining = true;
            this.emit(EVENT.user_login_begin, user);

            this.off(this._handleUserLoginFinishEvent);
            this._handleUserLoginFinishEvent = this.once(EVENT.user_login_message, (serverUser, error) => {
                this._handleUserLoginFinishEvent = false;
                this._handleUserLoginFinish(user, serverUser, error);
            });

            API.requestServerInfo(user).then(user => {
                if(this.socket) {
                    this.socket.destroy();
                }
                this.socket = new Socket(app, user);
                this.emit(EVENT.app_socket_change, this.socket);
            }).catch((err) => {
                err.oringeMessage = err.message;
                err.message = Lang.errors[err && err.code ? err.code : 'WRONG_CONNECT'] || err.message;
                if(DEBUG) console.error(err);
                this.emit(EVENT.user_login_message, null, err);
            });
        } else {
            return this.oldLogin(user);
        }
    }

    /**
     * Login with user for old version
     * @param  {object} user
     * @return {void}
     */
    oldLogin(user) {
        if(!user) user = this.user;
        else user = this.resetUser(user);

        this.isUserLogining = true;
        this.emit(EVENT.user_login_begin, user);

        this.off(this._handleUserLoginFinishEvent);
        this._handleUserLoginFinishEvent = this.once(EVENT.user_login_message, (serverUser, error) => {
            this._handleUserLoginFinishEvent = false;
            this._handleUserLoginFinish(user, serverUser, error);
        });

        API.getZentaoConfig(user.zentao).then(zentaoConfig => {
            user.zentaoConfig = zentaoConfig;
            if(this.socket) {
                this.socket.destroy();
            }
            this.socket = new Socket(app, user);
            this.emit(EVENT.app_socket_change, this.socket);
        }).catch(err => {
            err.oringeMessage = err.message;
            err.message = Lang.errors[err && err.code ? err.code : 'WRONG_CONNECT'] || err.message;
            if(DEBUG) console.error(err);
            this.emit(EVENT.user_login_message, null, err);
        });
    }

    /**
     * Make user data path
     * @return {boolean}
     */
    _makeUserDataPath(user) {
        user = user || this.user;
        let userDataPath = Path.join(this.userDataPath, 'users/' + user.identify);
        user.dataPath = userDataPath;
        return Helper.tryMkdirp(userDataPath).then(() => {
            return Promise.all([
                Helper.tryMkdirp(Path.join(userDataPath, 'temp/')),
                Helper.tryMkdirp(Path.join(userDataPath, 'images/')),
                Helper.tryMkdirp(Path.join(userDataPath, 'files/'))
            ]);
        });
    }

    /**
     * Handle user login with api data
     * @param  {User} user
     * @param  {Object} serverUser
     * @param  {Error} error
     * @return {Void}
     */
    _handleUserLoginFinish(user, serverUser, error) {
        if(serverUser) {
            // update user
            let serverStatus = serverUser.status;
            delete serverUser.status;
            user.lastLoginTime = new Date().getTime();
            user.assign(serverUser);
            user.fixAvatar();

            // init dao
            if(!this.dao || this.dao.dbName !== user.identify) {
                this.dao = new DAO(user, this);
            } else {
                this.dao.user = user;
            }

            // update socket
            this.socket.user = user;
            this.socket.dao = this.dao;

            // init user data path
            this._makeUserDataPath(user).then(() => {
                if(DEBUG) {
                    console.log('%cUSER DATA PATH ' + this.user.dataPath, 'display: inline-block; font-size: 10px; color: #009688; background: #A7FFEB; border: 1px solid #A7FFEB; padding: 1px 5px; border-radius: 2px;');
                }
                this.config.save(user);
                // API.tryLogin(user);

                setTimeout(() => {
                    // set user status
                    this.user = user;
                    this.user.changeStatus(serverStatus || 'online')
                    this.socket.user = user;
                    this.isUserLogining = false;
                    this.emit(R.event.user_login_finish, {user: user, result: true});
                }, 2000);
            }).catch(err => {
                this.user = user;
                let error = new Error('Cant not init user data path.');
                error.code = 'USER_DATA_PATH_DENY';
                this.isUserLogining = false;
                this.emit(R.event.user_login_finish, {user: user, result: false, error});
                if(DEBUG) console.error(error);
            });
        } else {
            if(this.socket) {
                this.socket.destroy();
            }
            this.user = user;
            this.isUserLogining = false;
            this.emit(R.event.user_login_finish, {user: user, result: false, error});
        }
    }

    /**
     * Logout
     * @return {Void}
     */
    logout() {
        if(this.user) {
            if(this.user.isOnline) this.config.save(this.user, true);
            this.user.changeStatus(USER_STATUS.unverified);
            this.socket.logout(this.user);
        }
    }

    /**
     * Chnage user status
     * @param  {String} status
     * @return {Void}
     */
    changeUserStatus(status) {
        if(status !== 'offline') {
            this.socket.changeUserStatus(status);
        } else {
            this.logout();
        }
    }

    /**
     * Show and focus main window
     * @return {void}
     */
    showAndFocusWindow() {
        this.browserWindow.show();
        this.browserWindow.focus();
    }

    /**
     * Play soudn
     * @param  {string} sound name
     * @return {void}
     */
    playSound(sound) {
        // determine play sound by user config
        window.ion.sound.play(sound);
    }

    /**
     * Preview file
     */
    previewFile(path, displayName) {
        if(Help.isOSX) {
            this.browserWindow.previewFile(path, displayName);
        } else {
            // TODO: preview file on windows
        }
    }

    /**
     * Set current badage label
     * @param  {string | false} label
     * @return {void}
     */
    set badgeLabel(label = '') {
        this.remote('dockBadgeLabel', (label || '') + '');
    }

    /**
     * Check whether the main window is open and focus
     * @return {boolean}
     */
    get isWindowOpenAndFocus() {
        return this.browserWindow.isFocused() && this.isWindowOpen;
    }

    /**
     * Check whether the main window is open
     */
    get isWindowOpen() {
        return this.browserWindow.isVisible() && !this.browserWindow.isMinimized();
    }

    /**
     * Check whether the main window is focused
     */
    get isWindowsFocus() {
        return this.browserWindow.isFocused();
    }

    /**
     * Request attention to the main window
     * @return {void}
     */
    requestAttention(attention) {
        this.remote('dockBounce', 'informational');

        this.browserWindow.flashFrame(true);
        clearTimeout(this.flashFrameTask);
        this.flashFrameTask = setTimeout(() => {
            this.browserWindow.flashFrame(false);
        }, 3000);
    }

    /**
     * Set tooltip text on tray icon
     * @param  {string | false} tooltip
     * @return {void}
     */
    set trayTooltip(tooltip) {
        this.remote('trayTooltip', tooltip);
    }

    /**
     * Flash tray icon
     * @param  {boolean} flash
     * @return {void}
     */
    flashTrayIcon(flash = true) {
        this.remote('flashTrayIcon', flash);
    }

    /**
     * Create context menu
     * @param  {Array[Object]} items
     * @return {Menu}
     */
    createContextMenu(menu) {
        if(Array.isArray(menu) && !menu.popup) {
            menu = Menu.buildFromTemplate(menu);
        }
        return menu;
    }

    /**
     * Popup context menu
     */
    popupContextMenu(menu, x, y) {
        if(typeof x === 'object') {
            y = x.clientY;
            x = x.clientX;
        }
        menu = this.createContextMenu(menu);
        menu.popup(this.browserWindow, x, y);
    }

    /**
     * Show save dialog
     * @param object   options
     */
    showSaveDialog(options, callback) {
        if(options.sourceFilePath) {
            let sourceFilePath = options.sourceFilePath;
            delete options.sourceFilePath;
            return this.showSaveDialog(options, filename => {
                if(filename) {
                    Helper.copyFile(sourceFilePath, filename)
                          .then(() => {
                             callback && callback(filename);
                          }).catch(callback);
                } else {
                    callback && callback();
                }
            });
        }

        let filename = options.fileName || '';
        delete options.fileName;

        options = Object.assign({
            title: Lang.dialog.fileSaveTo,
            defaultPath: Path.join(this.desktopPath, filename)
        }, options);
        Dialog.showSaveDialog(this.browserWindow, options, callback);
    }

    /**
     * Show open dialog
     */
    showOpenDialog(options, callback) {
        options = Object.assign({
            title: Lang.dialog.openFile,
            defaultPath: this.desktopPath,
            properties: ['openFile']
        }, options);
        Dialog.showOpenDialog(this.browserWindow, options, callback);
    }

    /**
     * Open dialog window
     * @param  {Object} options
     * @return {Promise}
     */
    openDialog(options) {
        Modal.show(options);
    }

    /**
     * Open member profile window
     * @param  {Object} options
     * @param  {Member} member
     * @return {Promise}
     */
    openProfile(options, member) {
        let title = null;
        member = member || (options ? options.member : null);
        if(!member) {
            member = this.user;
            title = this.lang.user.profile;
        }
        if(!member) return Promise.reject('Member is null.');

        options = Object.assign({
            content: () => {
                return <ContactView onSendBtnClick={() => {
                    Modal.hide();
                }} member={member}/>;
            },
            width: 500,
            actions: false
        }, options);
        Modal.show({
            content: () => {
                return <ContactView onSendBtnClick={() => {
                    Modal.hide();
                }} member={member}/>;
            },
            width: 500,
            actions: false
        });
    }

    /**
     * Open about window
     * @return {Promise}
     */
    openAbout() {
        Modal.show({
            header: this.lang.common.about,
            content: () => {
                return <AboutView/>;
            },
            width: 300,
            actions: null
        });
    }

    /**
     * Get all members
     * @return {Array[Member]}
     */
    get members() {
        return this.dao.getMembers(true);
    }

    /**
     * Change @user to html link tag
     * @param  {string} text
     * @param  {string} format
     * @return {string}
     */
    linkMembersInText(text, format = '<a class="link-app" href="#Member/{id}">@{displayName}</a>') {
        if(text.indexOf('@') > -1) {
            this.dao.getMembers().forEach(m => {
                text = text.replace(new RegExp('@(' + m.account + '|' + m.realname + ')', 'g'), format.format({displayName: m.displayName, id: m.id, account: m.account}));
            });
        }
        return text;
    }

    /**
     * change http://example.com to html link tag
     * @param  {string} text
     * @param  {string} format
     * @return {string}
     */
    linkHyperlinkInText(text, format = '<a href="{0}">{1}</a>') {
        let urlPattern = '\\b((?:[a-z][\\w\\-]+:(?:\\/{1,3}|[a-z0-9%])|www\\d{0,3}[.]|[a-z0-9.\\-]+[.][a-z]{2,4}\\/)(?:[^\\s()<>]|\\((?:[^\\s()<>]|(?:\\([^\\s()<>]+\\)))*\\))+(?:\\((?:[^\\s()<>]|(?:\\([^\\s()<>]+\\)))*\\)|[^\\s`!()\\[\\]{};:\'".,<>?«»“”‘’]))';
        return text.replace(new RegExp(urlPattern, 'ig'), url => {
            let colonIdx = url.indexOf(':');
            if(url.includes('://') || (colonIdx < 7 && colonIdx > 0)) {
                return format.format(url, url);
            }
            return format.format('http://' + url, url);
        });
    }

    openImagePreview(imagePath, callback) {
        Modal.show({
            content: () => {
                return <ImageView sourceImage={imagePath} />;
            },
            closeButtonStyle: {color: '#fff', fill: '#fff', background: 'rgba(0,0,0,0.2)'},
            fullscreen: true,
            clickThrough: true,
            transparent: true,
            actions: false,
            onHide: callback
        });
    }

    /**
     * Capture screenshot image and save to file
     * 
     * @param string filePath optional
     */
    captureScreen(options, filePath, hideCurrentWindow, onlyBase64) {
        if(!filePath) {
            filePath = this.user.makeFilePath(UUID.v4() + '.png');
        }
        if(!options) {
            options = {};
        }
        let processImage = base64Image => {
            if(hideCurrentWindow) {
                this.browserWindow.show();
            }
            if(onlyBase64) return Promise.resolve(base64Image);
            return Helper.saveImage(base64Image, filePath);
        };
        if(hideCurrentWindow && this.browserWindow.isVisible()) {
            if(Helper.isWindowsOS) {
                let hideWindowTask = () => {
                    this.browserWindow.hide();
                    return new Promise((resolve, reject) => {
                        setTimeout(resolve, 600);
                    });
                };
                return hideWindowTask().then(() => {
                    return takeScreenshot(options);
                }).then(processImage);
            }
            this.browserWindow.hide();
        }
        return takeScreenshot(options).then(processImage);
    }

    /**
     * Open capture screen window
     */
    openCaptureScreen(screenSources = 0, hideCurrentWindow = false) {
        let openCaptureScreenWindow = (file, display) => {
            return new Promise((resolve, reject) => {
                let captureWindow = new BrowserWindow({
                    x: display ? display.bounds.x : 0,
                    y: display ? display.bounds.y : 0,
                    width: display ? display.bounds.width : screen.width,
                    height: display ? display.bounds.height : screen.height,
                    alwaysOnTop: !DEBUG,
                    fullscreen: true,
                    frame: true,
                    show: false,
                    title: Lang.chat.captureScreen + ' - ' + display.id,
                    titleBarStyle: 'hidden',
                    resizable: false,
                });
                if (DEBUG) {
                    captureWindow.openDevTools();
                }
                captureWindow.loadURL(`file://${this.appRoot}/capture-screen.html#` + encodeURIComponent(file.path));
                captureWindow.webContents.on('did-finish-load', () => {
                    captureWindow.show();
                    captureWindow.focus();
                    resolve(captureWindow);
                });
            });
        };
        if(screenSources === 'all') {
            let displays = Screen.getAllDisplays();
            screenSources = displays.map(display => {
                display.sourceId = display.id;
                return display;
            });
        }
        if(!Array.isArray(screenSources)) {
            screenSources = [screenSources];
        }
        hideCurrentWindow = hideCurrentWindow && this.browserWindow.isVisible();
        return new Promise((resolve, reject) => {
            let captureScreenWindows = [];
            Event.ipc.once(EVENT.capture_screen, (e, image) => {
                if(captureScreenWindows) {
                    captureScreenWindows.forEach(captureWindow => {
                        captureWindow.close();
                    });
                }
                if(hideCurrentWindow) {
                    this.browserWindow.show();
                    this.browserWindow.focus();
                }
                if(image) {
                    let filePath = this.user.makeFilePath(UUID.v4() + '.png');
                    Helper.saveImage(image.data, filePath).then(resolve).catch(reject);
                } else {
                    if(DEBUG) console.log('No capture image.');
                }
            });
            let takeScreenshots = () => {
                return Promise.all(screenSources.map(screenSource => {
                    return this.captureScreen(screenSource, '').then(file => {
                        return openCaptureScreenWindow(file, screenSource).then(captureWindow => {
                            captureScreenWindows.push(captureWindow);
                        });
                    });
                }));
            };
            if(hideCurrentWindow) {
                this.browserWindow.hide();
                setTimeout(() => {
                    takeScreenshots();
                }, Helper.isWindowsOS ? 600 : 0);
            } else {
                takeScreenshots();
            }
        });
        return this.captureScreen({sourceId: screenSource}, '', hideCurrentWindow).then(file => {
            return new Promise((resolve, reject) => {
                let captureWindow = new BrowserWindow({
                    x: 0,
                    y: 0,
                    width: screen.width,
                    height: screen.height,
                    alwaysOnTop: !DEBUG,
                    fullscreen: true,
                    frame: true,
                    show: false,
                    title: Lang.chat.captureScreen,
                    titleBarStyle: 'hidden',
                    resizable: false,
                });

                if (DEBUG) {
                    captureWindow.openDevTools();
                }
                captureWindow.loadURL(`file://${this.appRoot}/capture-screen.html#` + encodeURIComponent(file.path));
                captureWindow.webContents.on('did-finish-load', () => {
                    captureWindow.show();
                    captureWindow.focus();
                });
            })
        });
    }

    /**
     * Upload file to server with zentao API
     * @param  {File} file
     * @param  {object} params
     * @return {Promise}
     */
    uploadFile(file, params) {
        return API.uploadFile(file, this.user, params).catch(err => {
            console.error(err);
        });
    }

    /**
     * Download file from server with zentao API
     * @param  {File} file
     * @param  {function} onProgress
     * @return {Promise}
     */
    downloadFile(file, onProgress) {
        if(!file.path) file.path = this.user.tempPath + file.name;
        if(!file.url) file.url = this.createFileDownloadLink(file.id, this.user);
        return API.downloadFile(file, this.user, onProgress);
    }

    /**
     * Create file download link with zentao API
     * @param  {string} fileId
     * @return {string}
     */
    createFileDownloadLink(fileId) {
        return API.createFileDownloadLink(fileId, this.user);
    }

    /**
     * Register global hotkey
     * @param  {object} option
     * @param  {string} name
     * @return {void}
     */
    registerGlobalShortcut(name, accelerator, callback) {
        if(!this.shortcuts) {
            this.shortcuts = {};
        }
        this.unregisterGlobalShortcut(name);
        this.shortcuts[name] = accelerator;
        GlobalShortcut.register(accelerator, () => {
            if(DEBUG) console.log("%cGLOBAL KEY ACTIVE " + name + ': ' + accelerator, 'display: inline-block; font-size: 10px; color: #fff; border: 1px solid #673AB7; padding: 1px 5px; border-radius: 2px; background: #673AB7');
            callback();
        });
        if(DEBUG) console.log("%cGLOBAL KEY BIND " + name + ': ' + accelerator, 'display: inline-block; font-size: 10px; color: #673AB7; border: 1px solid #673AB7; padding: 1px 5px; border-radius: 2px');
    }

    /**
     * Check a shortcu whether is registered
     */
    isGlobalShortcutRegistered(accelerator) {
        return GlobalShortcut.isRegistered(accelerator);
    }

    /**
     * Unregister global hotkey
     * @param  {gui.Shortcut | string | object} hotkey
     * @return {void}
     */
    unregisterGlobalShortcut(name) {
        if(this.shortcuts && this.shortcuts[name]) {
            GlobalShortcut.unregister(this.shortcuts[name]);
            delete this.shortcuts[name];
        }
    }

    /**
     * Quit application
     */
    quit() {
        if(this.saveUserTimerTask) {
            this.saveUser();
        }
        this.remote('quit');
    }
}

const app = new App();

global.App = app;

export {config as Config, app as App, Lang}
export default app;
