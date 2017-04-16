import AppCore                           from '../app-core';
import React                             from 'react';
import {User, Member, Chat, ChatMessage} from '../entities';
import R                                 from '../../resource';
import ChatDao                           from './dao';
import Path                              from 'path';
import PKG                               from '../../package.json';
import Moment                            from 'moment';
import Modal                             from 'Components/modal';
import TextField                         from 'material-ui/TextField';
import ChangeFontSize                    from 'Views/chat/change-font-size';
import SetCommitters                     from 'Views/chat/set-committers';
import Theme                             from 'Theme';
import Lang                              from 'Lang';
import AppActionLink                     from 'Utils/app-link';
import Helper                            from 'Helper';
import NewChatWindow                     from 'Views/chat/newchat';
import Checkbox                          from 'material-ui/Checkbox';

const MAX_RECENT_TIME  = 1000*60*60*24*7;
const SEARCH_SCORE_MAP = {
    matchAll   : 100,
    matchPrefix: 75,
    include    : 50,
    similar    : 10
};

/**
 * Chat application handler
 */
class ChatApp extends AppCore {
    constructor(app) {
        super(app);

        // Store then actived chat window id
        this.activeChatWindow;

        // Handle application events
        app.on(R.event.app_socket_change, () => {
            this.socket.setHandler({
                chat: {
                    changename: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.name = msg.data.name;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    setcommitters: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.committers = msg.data.committers;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    addmember: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                let serverChatMembers = new Chat(msg.data).members;
                                let newMembers = [];
                                serverChatMembers.forEach(x => {
                                    if(!chat.members.has(x)) {
                                        newMembers.push(x);
                                    }
                                });

                                if(newMembers.length) {
                                    chat.addMessage(new ChatMessage({
                                        type: 'broadcast',
                                        content: this.$app.lang.chat.someoneJoinChat.format(newMembers.map(x => this.$dao.members[x].displayName).join(', ')),
                                        cgid: chat.gid,
                                        date: new Date(),
                                        sender: this.user
                                    }));
                                }

                                chat.assign(msg.data);
                                chat.updateMembersSet(this);
                                this.dao.updateChats(chat);
                            } else {
                                chat = new Chat(msg.data);
                                chat.updateWithApp(this);
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    getlist: msg => {
                        if(msg.isSuccess) {
                            let chats = Object.keys(msg.data).map(key => {
                                let chat = new Chat(msg.data[key]);
                                chat.updateWithApp(this);
                                return chat;
                            });

                            this.dao.initChats(chats);
                        }
                    },
                    create: msg => {
                        if(msg.isSuccess) {
                            let chat = new Chat(msg.data);
                            chat.updateWithApp(this);

                            this.dao.updateChats(chat);
                            this.$app.emit(R.event.chat_create, chat);
                        }
                    },
                    message: msg => {
                        if(msg.isSuccess) {
                            let messages = msg.data;
                            if(!Array.isArray(messages)) {
                                if(messages.cgid && messages.content) {
                                    messages = [messages];
                                } else {
                                    messages = Object.keys(messages).map(x => messages[x]);
                                }
                            }

                            messages = messages.map(x => new ChatMessage(x));

                            if(messages && messages.length) {
                                this.dao.updateChatMessages(messages, this.user.id);
                            }
                        }
                    },
                    history: msg => {
                        if(msg.isSuccess) {
                            let messages = msg.data;
                            if(!Array.isArray(messages)) {
                                if(messages.cgid && messages.content) {
                                    messages = [messages];
                                } else {
                                    messages = Object.keys(messages).map(x => messages[x]);
                                }
                            }

                            messages = messages.map(x => new ChatMessage(x));

                            if(messages && messages.length) {
                                this.dao.updateChatMessages(messages, false, true);
                            }

                            let pager = msg.pager;
                            pager.isFetchOver = pager.pageID * pager.recPerPage >= pager.recTotal;
                            if(pager.continued && !pager.isFetchOver) {
                                this.getChatHistory(pager.gid, {
                                    recPerPage: pager.recPerPage, 
                                    pageID: pager.pageID + 1, 
                                    recTotal: pager.recTotal, 
                                    continued: true
                                });
                            }
                            this.$app.emit(R.event.chats_history, messages, pager);
                        }
                    },
                    star: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.star = msg.data.star;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    joinchat: msg => {
                        if(msg.isSuccess) {
                            if(!msg.data.join) {
                                this.dao.deleteChat(msg.data.gid);
                            } else {
                                let chat = this.dao.getChat(msg.data.gid);
                                if(chat) {
                                    chat.addMember(this.user);
                                    this.dao.updateChats(chat);
                                } else {
                                    chat = new Chat(msg.data.chat);
                                    chat.updateWithApp(this);
                                    this.dao.updateChats(chat);
                                }
                            }
                        }
                    },
                    hide: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.hide = msg.data.hide;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    changepublic: msg => {
                        if(msg.isSuccess) {
                            let chat = this.dao.getChat(msg.data.gid);
                            if(chat) {
                                chat.public = msg.data.public;
                                this.dao.updateChats(chat);
                            }
                        }
                    },
                    getpubliclist: msg => {
                        let chats;
                        if(msg.isSuccess) {
                            chats = msg.data.map(x => {
                                let chat = new Chat(x);
                                chat.updateMembersSet(this);
                                return chat;
                            });
                        } else {
                            chats = [];
                        }
                        this.$app.emit(R.event.data_get_public_list, chats);
                    },
                }
            });
        });

        app.on(R.event.chats_notice, (data) => {
            let totalNoticeCount = 0;
            let chats = this.dao.getChats(x => {
                if(x.noticeCount && (!this.$app.isWindowOpen || !this.$app.isWindowsFocus || x.gid !== this.activeChatWindow)) {
                    totalNoticeCount += x.noticeCount;
                    this.lastNoticeChatGid = x.gid;
                } else {
                    x.noticeCount = 0;
                }
                return false;
            });
            if(this.totalNoticeCount !== totalNoticeCount) {
                this.totalNoticeCount = totalNoticeCount || false;
                this.$app.badgeLabel = this.totalNoticeCount;
                this.$app.trayTooltip = this.totalNoticeCount ? (this.$app.lang.chat.someNewMessages || '{0} 条新消息').format(this.totalNoticeCount) : false;
                if(this.totalNoticeCount && !this.$app.isWindowOpenAndFocus) {
                    if(Helper.isWindowsOS) {
                        if(!this.$app.isWindowOpen) this.$app.flashTrayIcon(this.totalNoticeCount);
                        this.$app.requestAttention();
                    }
                    if(!this.$app.isWindowOpen) this.$app.playSound('message');
                }
                this.$app.emit(R.event.chats_notice_change, totalNoticeCount);
            }
        });

        app.on(R.event.ui_show_main_window, () => {
            if(Helper.isWindowsOS) this.$app.flashTrayIcon(false);
            if(this.totalNoticeCount && this.lastNoticeChatGid) {
                let chat = this.dao.getChat(this.lastNoticeChatGid, true, true);
                this.$app.emit(R.event.ui_change, {navbar: R.ui.navbar_chat, activeChat: this.lastNoticeChatGid});
            }
        });

        app.on(R.event.ui_focus_main_window, () => {
            if(Helper.isWindowsOS) this.$app.flashTrayIcon(false);
            if(this.activeChatWindow) {
                let chat = this.dao.getChat(this.activeChatWindow, true, true);
                if(chat && chat.noticeCount) {
                    this.$app.emit(R.event.ui_change, {navbar: R.ui.navbar_chat, activeChat: chat.gid});
                }
            }
        });

        app.on(R.event.user_login_finish, e => {
            if(e.result) {
                this.registerGlobalHotKey();
            }
        });
    }

    /**
     * Register global hotkey
     */
    registerGlobalHotKey() {
        this.$app.registerGlobalShortcut('captureScreen', App.user.config.shortcut.captureScreen || 'ctrl+alt+z', () => {
            this.captureAndSendScreen()
        });
    }

    /**
     * Init dao object
     * @return {object}
     */
    initDao() {
        return new ChatDao(this);
    }

    /**
     * Create chat
     * @param  {Object}   chat
     * @param  {function} callback
     * @return {void
     */
    createChat(chat, callback) {
        if(callback) {
            this.$app.once(R.event.chat_create, callback);
        }
        this.socket.send(this.socket.createSocketMessage({
            'method': 'create',
            'params': [chat.gid, chat.name || '', chat.type, chat.members, 0]
        }));
    }

    /**
     * Create chat with with members
     * @param  {[Member]} members
     * @return {void}
     */
    create(members, options, callback) {
        if(typeof options === 'function') {
            callback = options;
            options = {};
        }
        options = Object.assign({
            onlyLocal: false,
            notifyUIChange: true,
            confirmGroupName: false
        }, options);
        if(!Array.isArray(members)) {
            members = [members];
        }
        if(!members.find(member => member.id === this.user.id)) {
            members.push(this.user);
        }

        let chat = null;
        if(members.length <= 2) {
            const gid = [member.id, this.$app.user.id].sort().join('&');
            chat = this.dao.chats[gid];
        }
        if(!chat) {
            chat = new Chat(Object.assign({
                membersSet: members,
                createdBy: this.user.account
            }, options.data));
        }

        if(!options.onlyLocal && chat) {
            let upsertRemote = () => {
                this.dao.updateChats(chat);
                this.createChat(chat, callback);
                if(options.notifyUIChange) {
                    this.$app.emit(R.event.ui_change, {navbar: R.ui.navbar_chat, activeChat: chat.gid});
                }
            }
            if(chat.isGroup && options.confirmGroupName) {
                this.renamePrompt(chat, ct => {
                    if(ct) {
                        chat = ct;
                        upsertRemote();
                    }
                }, {
                    title: this.lang.chat.startGroupChat.format(members.length),
                    label: this.lang.common.create
                });
            } else {
                upsertRemote();
            }
        } else {
            if(chat.isGroup && options.confirmGroupName) {
                this.renamePrompt(chat, callback, {
                    title: this.lang.chat.startGroupChat.format(members.length),
                    label: this.lang.common.create
                });
            } else{
                callback && callback(chat);
            }
        }
        return chat;
    }

    /**
     * create group
     * @param  {members} members
     * @param  {[type]} confirmName [description]
     * @return {[type]}             [description]
     */
    createGroup(members, confirmName) {
        if(!members.find(member => member.id === this.user.id)) {
            members.push(this.user);
        }
    }

    /**
     * Get all chats
     * @return {[type]} [description]
     */
    get all() {
        return this.dao ? this.dao.getChats() : [];
    }

    /**
     * Get recent chats
     * @param  {bool} ignoreStar
     * @return {array}
     */
    getRecents(includeStar) {
        const all = this.all;
        if(all.length < 2) return all;

        var now = new Date().getTime();
        return all.filter(chat => {
            return (includeStar && chat.star) || (chat.lastActiveTime && (now - chat.lastActiveTime) <= MAX_RECENT_TIME);
        });
    }

    /**
     * Get contacts chats
     * @return {array}
     */
    getContactsChats() {
        let chats = [];
        this.$app.members.forEach(member => {
            if(member.id !== this.user.id) {
                chats.push(this.getContactChat(member));
            }
        });
        return chats;
    }

    /**
     * Get contact chat
     * @param  {object} member
     * @return {object}
     */
    getContactChat(member) {
        let members = [member.id, this.$app.user.id].sort();
        const gid = members.join('&');
        let chat = this.dao.chats[gid];
        if(chat) return chat;
        chat = new Chat({
            gid,
            members,
            createdBy: this.user.account,
            type: 'one2one'
        });
        chat.updateMembersSet(this);
        this.dao.chats[gid] = chat;
        return chat;
    }

    /**
     * Get group chats
     * @return {array}
     */
    getGroups() {
        return this.all.filter(chat => {
            return chat.isGroup || chat.isSystem;
        });
    }

    /**
     * Search chats
     * @param  {string} search
     * @return {array}  chat array
     */
    searchChats(search) {
        if(Helper.isEmptyString(search)) return [];
        search = search.trim().toLowerCase().split(' ');
        if(!search.length) return [];

        this.getContactsChats();

        let result = [];
        let caculateScore = (sKey, whitch) => {
            if(Helper.isEmptyString(sKey) || Helper.isEmptyString(whitch)) return 0;
            if(sKey === whitch) return SEARCH_SCORE_MAP.matchAll;
            let idx = whitch.indexOf(sKey);
            return idx === 0 ? SEARCH_SCORE_MAP.matchPrefix : (idx > 0 ? SEARCH_SCORE_MAP.include : 0);
        };
        Object.keys(this.dao.chats).forEach(gid => {
            let chat = this.dao.chats[gid];
            let score = 0;
            let chatGid = chat.gid.toLowerCase();
            let chatName = chat.getDisplayName(this.$app, false).toLowerCase();
            let pinYin = chat.getPinYin(chatName);
            let theOtherOneName = '';
            let theOtherOneAccount = '';
            if(chat.isOne2One) {
                let theOtherOne = chat.getTheOtherOne(this.user);
                theOtherOneAccount = theOtherOne.account;
            }
            search.forEach(s => {
                if(!s.length) return;
                if(s.length > 1) {
                    if(s[0] === '#') { // id
                        s = s.substr(1);
                        score += 2*caculateScore(s, chatGid);
                        if(chat.isSystem || chat.isGroup) {
                            score += 2*caculateScore(s, chatName);
                            if(chat.isSystem) {
                                score += 2*caculateScore(s, 'system');
                            }
                        }
                    } else if(s[0] === '@') { // account or username
                        s = s.substr(1);
                        if(chat.isOne2One) {
                            score += 2*caculateScore(s, theOtherOneAccount);
                        }
                    }
                }
                score += caculateScore(s, chatName);
                score += caculateScore(s, pinYin);
            });
            chat.$.score = score;
            if(score > 0) {
                result.push(chat);
            }
        });
        return result.sort((x, y) => x.$.score - y.$.score);
    }

    /**
     * Create chat action context menu
     * @param  {Chat} chat
     * @return {gui.Menu}
     */
    createActionsContextMenu(chat) {
        let menu = [];
        if(chat.isOne2One) {
            menu.push({
                label: this.lang.user.viewProfile,
                click: () => {
                    this.$app.openProfile({member: chat.getTheOtherOne(this.user), inModal: true});
                }
            }, {
                type: 'separator'
            });
        }

        menu.push({
            label: chat.star ? this.lang.chat.removeStar : this.lang.chat.star,
            click: () => {
                this.toggleStar(chat);
            }
        });

        if(chat.canRename(this.user)) {
            menu.push({
                label: this.lang.common.rename,
                click: () => {
                    this.renamePrompt(chat);
                }
            });
        }

        if(chat.canMakePublic(this.user)) {
            menu.push({
                label: chat.public ? this.lang.chat.cancelSetPublic : this.lang.chat.setPublic,
                click: () => {
                    this.togglePublic(chat);
                }
            });
        }

        if(chat.canExit) {
            menu.push({
                type: 'separator'
            }, {
                label: this.lang.chat.exitChat,
                click: () => {
                    this.exitConfirm(chat);
                }
            });
        }

        return this.$app.createContextMenu(menu);
    }

    /**
     * Create chat member context menu
     * @param  object chat
     * @param  object member
     * @return object
     */
    createChatMemberContextMenu(chat, member) {
        if(chat instanceof ChatMessage) {
            if(!member) member = chat.sender;
            chat = this.dao.getChat(chat.cgid);
        }
        let menu = [];
        if(!chat.isOne2One && member.id !== this.user.id) {
            menu.push({
                label: this.lang.chat.atHim,
                click: () => {
                    this.$app.emit(R.event.ui_link, new AppActionLink('@Member/' + member.account));
                }
            }, {
                label: this.lang.chat.sendMessage,
                click: () => {
                    this.create(member);
                }
            });
        }
        menu.push({
            label: this.lang.user.viewProfile,
            click: () => {
                this.$app.openProfile({member, inModal: true});
            }
        });

        if(chat.hasWhitelist && chat.isAdmin(this.user)) {
            let isCommitter = chat.isCommitter(member);
            menu.push({
                type: 'separator'
            }, {
                label: isCommitter ? this.lang.chat.removeFromWhitelist : this.lang.chat.addToWhitelist,
                click: () => {
                    if(isCommitter) {
                        chat.removeFromWhitelist(member);
                    } else {
                        chat.addToWhitelist(member);
                    }
                    this.setCommitters(chat, chat.whitelist);
                }
            });
        }

        return this.$app.createContextMenu(menu);
    }

    /**
     * Open a confirm window ask user to exit chat
     */
    exitConfirm(chat) {
        Modal.show({
            modal: true,
            closeButton: false,
            contentStyle: {paddingTop: 20},
            content: this.lang.chat.exitChatConfirm.format(chat.getDisplayName(this.$app)),
            width: 360,
            actions: [{type: 'cancel'}, {type: 'submit'}],
            onSubmit: () => {
                this.exit(chat);
            }
        });
    }

    /**
     * Open a dialog for user to change font size of chat UI
     */
    changeChatFontSize() {
        Modal.show({
            id: 'changeChatFontSizeModal',
            header: this.lang.chat.changeFontSize,
            content: <ChangeFontSize onCloseClick={() => {
                Modal.hide('changeChatFontSizeModal', true);
            }}/>,
            width: 500,
            actions: null
        });
    }

    /**
     * Open a prompt window for user rename a chat
     */
    renamePrompt(chat, callback, options) {
        let newName = null;
        let isPublic = chat.public;
        let content = <div>
            <p>{(options && options.title) || (!chat.name ? this.lang.chat.setChatName : this.lang.chat.renameTheChat.format(chat.name))}</p>
            <TextField
              ref={(e) => setTimeout(() => {
                  if(e) e.focus();
              }, 400)}
              hintText={this.lang.chat.inputChatNewName}
              onChange={e => {newName = e.target.value}}
              defaultValue={chat.name}
              fullWidth={true}
            />
            {(options && options.setPublic && chat.isGroup) ? <Checkbox style={{marginTop: 8}} label={options.setPublicLabel || this.lang.chat.setPublic} onCheck={(e, isChecked) => {isPublic = isChecked;}}/> : null}
        </div>;
        Modal.show({
            modal: true,
            closeButton: false,
            content: content,
            width: 360,
            actions: [{type: 'cancel'}, {type: 'submit', label: (options && options.label) || this.lang.common.rename}],
            onSubmit: () => {
                if(Helper.isNotEmptyString(newName) && newName !== chat.name) {
                    this.rename(chat, newName);
                }
                if(options && options.setPublic) {
                    chat.public = isPublic;
                }
                callback && callback(chat, newName, isPublic);
            },
            onCancel: () => {
                callback && callback(false, chat);
            }
        });
    }

    /**
     * Open a dialog for user to set chat committers
     */
    openCommittersDialog(chat) {
        let setCommittersView = null;
        Modal.show({
            modal: true,
            header: this.lang.chat.setChatCommitters.format(chat.getDisplayName(this.$app)),
            content: <SetCommitters ref={e => {setCommittersView = e;}} chat={chat}/>,
            width: 800,
            actions: [{type: 'cancel'}, {type: 'submit', label: this.lang.common.confirm}],
            onSubmit: () => {
                if(setCommittersView) {
                    this.setCommitters(chat, setCommittersView.getCommitters());
                }
            }
        });
    }

    setCommitters(chat, committers) {
        if(committers instanceof Set) {
            committers = Array.from(committers);
        }
        if(Array.isArray(committers)) {
            committers = committers.join(',');
        }
        this.socket.send(this.socket.createSocketMessage({
            'method': 'setCommitters',
            'params': [chat.gid, committers]
        }));
    }

    /**
     * Open create new chat modal
     * @param  {number} chat
     * @return {void}
     */
    openCreateNewChat(chat) {
        Modal.show({
            id: 'new-chat',
            removeAfterHide: true,
            header: Lang.chat.newChat,
            headerStyle: {backgroundColor: Theme.color.pale2},
            content:  () => {
                return <NewChatWindow chat={chat} className="dock-full" style={{top: 50}}/>;
            },
            style: {left: 20, top: 20, right: 20, bottom: 0, position: 'absolute', overflow: 'hidden'},
            actions: false
        });
    }

    /**
     * Toggle chat
     * @param  {Chat} chat
     * @return {void}
     */
    toggleShow(chat) {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'hide',
            'params': [chat.gid, !!!chat.hide]
        }));
    }

    /**
     * Toggle chat public status
     * @param  {Chat} chat
     * @return {void}
     */
    togglePublic(chat) {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'changePublic',
            'params': [chat.gid, !!!chat.public]
        }));
    }

    /**
     * Get all public chats as list
     * @return {void}
     */
    getPublicList() {
        this.socket.send(this.socket.createSocketMessage({
            'method': 'getPublicList'
        }));
    }

    /**
     * Get chat history by options
     * @param  {Chat} chat
     * @param  {Object} options (optional)
     * @return {void}
     */
    getChatHistory(chat, options) {
        options = Object.assign({
            recPerPage: 20, 
            pageID: 1, 
            recTotal: 0, 
            continued: true
        }, options);
        let cgid = chat.gid || chat;
        this.socket.send(this.socket.createSocketMessage({
            'method': 'history',
            'params': [cgid, options.recPerPage, options.pageID, options.recTotal, options.continued]
        }));
    }

    /**
     * Delete local message
     */
    deleteLocalMessage(message, chat) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        chat.removeMessage(message);
        return new Promise((resolve, reject) => {
            this.dao.$dao.delete(message).then(x => {
                this.$dao._emit(R.event.data_change, {messages: [message], chats: [chat]});
                this.$dao._emit(R.event.data_delete, {messages: [message]});
                resolve();
            }).catch(reject);
        });
    }

    /**
     * Send socket message for chat
     * @param  {object} socketMessage
     * @param  {object} chat
     * @return {void}
     */
    sendSocketMessageForChat(socketMessage, chat) {
        socketMessage = this.socket.createSocketMessage(socketMessage);
        let sendCallback = () => {
            this.socket.send(socketMessage);
        };
        if(chat.remoteId) {
            sendCallback();
        } else {
            this.createChat(chat, sendCallback);
        }
    }

    /**
     * Send chat messages
     * @param  {[ChatMessage]} messages
     * @param  {Chat} chat
     * @return {void}
     */
    sendChatMessage(messages, chat) {
        if(chat && chat.isReadonly(this.user)) {
            this.$app.emit(R.event.ui_messager, {
                content: Lang.chat.blockedCommitterTip,
                color: Theme.color.negative
            });
            if(DEBUG) console.warn('The user try send messages in a readonly chat.', {chat, messages});
            return false;
        }
        if(!Array.isArray(messages)) messages = [messages];

        if(chat) chat.addMessage(...messages);
        this.dao.$dao.upsert(messages);
        return this.sendSocketMessageForChat({
            'method': 'message',
            'params': {
                messages: messages.map(m => {return {gid: m.gid, cgid: m.cgid, type: m.type, contentType: m.contentType, content: m.content, date: "", user: m.user}})
            }
        }, chat);
    }

    /**
     * Send chat message
     * @param  {ChatMessage} message
     * @return {void}
     */
    sendMessage(message, chat) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        if(chat && chat.isReadonly(this.user)) {
            this.$app.emit(R.event.ui_messager, {
                content: Lang.chat.blockedCommitterTip,
                color: Theme.color.negative
            });
            if(DEBUG) console.warn('The user try send message in a readonly chat.', {chat, message});
            return false;
        }
        let command = message.getCommand();
        if(command) {
            if(command.action === 'rename') {
                setTimeout(() => {
                    this.rename(this.dao.getChat(message.cgid), command.name);
                }, 500);
            } else if(command.action === 'version') {
                message.content = '```\n$$version = "' + `v${PKG.version}${PKG.distributeTime ? (' (' + Moment(PKG.distributeTime).format('YYYYMMDDHHmm') + ')') : ''}${DEBUG ? ' [debug]' : ''}` + '";\n```';
            }
        }
        this.sendChatMessage(message, chat);
    }

    /**
     * Rename a chat
     * @param  {Chat} chat
     * @param  {string} newName
     * @return {void}
     */
    rename(chat, newName) {
        if(chat && chat.canRename(this.user)) {
            if(chat.remoteId) {
                this.sendSocketMessageForChat({
                    'method': 'changeName',
                    'params': [chat.gid, newName]
                }, chat);
            } else {
                chat.name = newName;
            }
        }
    }

    /**
     * Capture screen image and send it
     * @param  {Chat} chat
     * @return {void}
     */
    captureAndSendScreen(chat) {
        if(!chat && this.activeChatWindow) {
            chat = this.dao.getChat(this.activeChatWindow);
        }

        if(!chat) return console.error('Select an chat before send screenshot.');
        App.openCaptureScreen('all').then(image => {
            if(image && image.path) {
                this.$app.emit(R.event.capture_screen_global, image, chat);
                this.$app.showAndFocusWindow();
            }
        });
    }

    /**
     * Upload image file and send message
     * @param  {ChatMessage} message
     * @param  {Chat} chat
     * @param  {function} reject
     * @return {void}
     */
    uploadMessageImage(message, chat, reject) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        if(!chat) return false;

        message.imageContent = Object.assign(message.imageContent, {send: 0, id: null});
        let file = message.attachFile;
        if(!file) file = message.imageContent;
        if(!file.path) file.path = Path.join(this.$app.user.imagesPath, file.name);

        this.sendChatMessage(message, chat);
        this.$app.uploadFile(file, {gid: chat.gid}).then(f => {
            message.imageContent = Object.assign(message.imageContent, f, {send: true});
            this.sendChatMessage(message, chat);
        }).catch(err => {
            message.imageContent = Object.assign(message.imageContent, {send: false});
            this.sendChatMessage(message, chat);
            return reject && reject(err);
        });
    }

    /**
     * Send image with message
     * @param  {Chat} chat
     * @param  {File} file
     * @param  {function} reject
     * @return {void}
     */
    sendImageMessage(chat, file, reject) {
        console.info('sendImageMessage', chat, file, reject);
        if(!file.path) {
            if(DEBUG) console.error('Cannot send image message ', file, chat);
            return;
        }

        let message = new ChatMessage({
            sender: this.user,
            cgid: chat.gid,
            date: new Date(),
            contentType: 'image',
            attachFile: file,
            imageContent: {name: file.name, size: file.size, send: 0, type: file.type}
        });

        let imagesPath = this.user.imagesPath;
        if(!file.path.startsWith(imagesPath)) {
            let fileName = this.user.makeFileName(file.type ? file.type.replace('image/', '.') : '.png');
            let filePath = Path.join(imagesPath, fileName);
            Helper.copyFile(file.path, filePath).then(() => {
                file = Object.assign({}, file, {path: filePath, name: fileName});
                message.attachFile = file;
                message.imageContent = Object.assign(message.imageContent, {path: filePath, name: fileName});
                this.uploadMessageImage(message, chat, reject);
            }).catch(err => {
                message.imageContent = Object.assign(message.imageContent, {send: false});
                this.sendChatMessage(message, chat);
                return reject && reject(err);
            });
        } else {
            this.uploadMessageImage(message, chat, reject);
        }
    }

    /**
     * Upload file with message
     * @param  {ChatMessage} message
     * @param  {Chat} chat
     * @param  {function} reject
     * @return {void}
     */
    uploadMessageFile(message, chat, reject) {
        if(!chat) chat = this.dao.getChat(message.cgid);
        if(!chat) return false;
        let file = message.attachFile;
        if(!file) return false;

        message.fileContent = Object.assign(message.fileContent, {send: 0});
        message.date = new Date().getTime();
        this.$app.emit(R.event.data_change, {chats: [chat]});
        
        this.$app.uploadFile(file, {gid: message.cgid}).then(f => {
            message.fileContent = Object.assign(message.fileContent, {send: true, id: f.id});
            this.sendChatMessage(message, chat);
        }).catch(err => {
            message.fileContent = Object.assign(message.fileContent, {send: false});
            this.$app.emit(R.event.data_change, {chats: [chat]});
            return reject && reject(err);
        });
    }

    /**
     * Send file with message
     * @param  {Chat} chat
     * @param  {File} file
     * @param  {function} reject
     * @return {void}
     */
    sendFileMessage(chat, file, reject) {
        let message = new ChatMessage({
            sender: this.user,
            cgid: chat.gid,
            date: new Date(),
            contentType: 'file',
            attachFile: file,
            fileContent: {name: file.name, size: file.size, send: 0, type: file.type},
        });

        chat.addMessage(message);
        
        this.uploadMessageFile(message, chat, reject);
    }

    /**
     * Invite members to chat
     * @param  {Chat} chat
     * @param  {[Member]} members
     * @return {void}
     */
    inviteMembers(chat, members) {
        if(chat.canInvite(this.user)) {
            if(!chat.isOne2One) {
                this.inviteMembersToChat(chat, members);
            } else {
                members.push(...chat.membersSet);
                this.create(...members);
            }
        }
    }

    /**
     * Invite members to chat
     * @param  {Chat} chat
     * @param  {[Members]} members
     * @return {void}
     */
    inviteMembersToChat(chat, members) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'addmember',
            'params': [chat.gid, members.map(x => x.id), true]
        }));
    }

    /**
     * Join a public chat
     * @param  {Chat} chat
     * @return {void}
     */
    joinChat(chat, join = true) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'joinchat',
            'params': [chat.gid, join]
        }));
    }

    /**
     * Request chats list by send socket message
     * @return {Void}
     */
    requestChatList() {
        return this.socket.send(this.socket.createSocketMessage({
            method: 'getList',
            module: 'chat',
            params: [this.user.id]
        }));
    }

    /**
     * Toggle star status of a chat
     * @param  {Chat} chat
     * @return {void}
     */
    toggleStar(chat) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'star',
            'params': [chat.gid, !chat.star]
        }));
    }

    /**
     * Exit a chat
     * @param  {Chat} chat
     * @return {void}
     */
    exit(chat) {
        return this.socket.send(this.socket.createSocketMessage({
            'method': 'joinchat',
            'params': [chat.gid, false]
        }));
    }

    /**
     * Query and get chat messages from local database
     * @param  {Chat} chat
     * @return {void}
     */
    getMessages(chat) {
        return this.$dao.all(`Message/${chat.gid}`);
    }
}

export default ChatApp;
