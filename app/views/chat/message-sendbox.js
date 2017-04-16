import {clipboard}         from 'electron';
import React               from 'react';
import Theme               from '../../theme';
import {App, Lang, Config} from '../../app';
import MessageListItem     from './message-list-item';
import MessageListDivider  from './message-list-divider';
import MessageTip          from './message-tip';
import EmoticonIcon        from 'material-ui/svg-icons/editor/insert-emoticon';
import SendIcon            from 'material-ui/svg-icons/hardware/keyboard-return';
import CutIcon             from 'material-ui/svg-icons/content/content-cut';
import HelpIcon            from 'material-ui/svg-icons/communication/live-help';
import IconButton          from 'material-ui/IconButton';
import ColorManipulator    from 'Utils/color-helper';
import Checkbox            from 'material-ui/Checkbox';
import FileIcon            from '../icons/file-outline';
import ImageIcon           from '../icons/message-image';
import Moment              from 'moment';
import Popover             from '../components/popover';
import Modal               from '../components/modal';
import EmoticonList        from '../components/emoticon-list';
import DraftEditor         from '../components/draft-editor';
import UUID                from 'uuid';
import Helper              from 'Helper';
import R                   from 'Resource';
import ShortcutField       from '../components/shortcut-field';
import EmojiPicker         from 'emojione-picker';

/**
 * React component: MessageSendbox
 */
const MessageSendbox = React.createClass({
    getInitialState() {
        return {
            expand: true,
            sendButtonDisabled: true
        };
    },

    _handleOnChange(contentState) {
        this.setState({sendButtonDisabled: !contentState.hasText()});
    },

    clearContent() {
        this.editbox.clearContent();
        this.setState({sendButtonDisabled: true})
    },

    focusInputArea() {
        this.editbox.focus();
    },

    _handleSendButtonClick() {
        if(!this.state.sendButtonDisabled) {
            return this.props.onSendButtonClick && this.props.onSendButtonClick(this);
        }
    },

    _handleEmoticonSelect(emoji) {
        Popover.hide('ChatEmojiSelectorPopover');

        this.editbox.appendContent(emoji.shortname + ' ');
        this.editbox.focus();
    },

    _handleEmoticonClick(e) {
        Popover.toggle({
            getLazyContent: () => <EmojiPicker categories={Lang.emojioneCategories} style={{height: 260}} onChange={data => {
                this._handleEmoticonSelect(data);
            }} />,
            contentId: 'chat-' + this.props.chatId,
            id: 'ChatEmojiSelectorPopover',
            removeAfterHide: true,
            trigger: this.emotionBtn,
            placement: 'top',
            style: {
                width: 280,
                height: 261
            },
            float: 'start'
        });
    },

    _handleOnReturnKeyDown(e) {
        if(!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
            if(!this.state.sendButtonDisabled) {
                setTimeout(() => {
                    this._handleSendButtonClick();
                }, 10);
            }
            e.preventDefault();
            return 'handled';
        }
        return 'not-handled';
    },

    _handleSelectImageFile(e) {
        this.appendImages(e.target.files);
    },

    _handleOnPaste(e) {
        if(!e || App.chat.activeChatWindow !== this.props.chatId) return;
        let imageFile = clipboard.readImage();
        let imageFileSize = imageFile.getSize();
        if(imageFileSize && imageFileSize.width * imageFileSize.height > 0) {
            let filename = UUID.v4() + '.png';
            let filePath = App.user.makeFilePath(filename);
            Helper.saveImage(imageFile, filePath).then(image => {
                image.width = imageFileSize.width;
                image.height = imageFileSize.height;
                image.filename = filename;
                image.name = filename;
                image.type = 'image/png';
                this.appendImages(image);
            });
            e.preventDefault();
        }
    },

    appendImages(images) {
        if(images instanceof FileList) {
            let files = images;
            images = [];
            for(let i = 0; i < files.length; ++i) {
                images.push(files[i]);
            }
        }
        if(!Array.isArray(images)) {
            images = [images];
        }
        images.forEach(image => {
            this.editbox.appendImage(image);
        });
        this.editbox.focus();
    },

    _handleSelectFile(e) {
        let file = e.target.files[0];
        return file && this.props.onSelectFile && this.props.onSelectFile(file);
    },

    _handleCaptureScreen(e) {
        App.openCaptureScreen('all').then(image => {
            this.editbox.appendImage(image);
            this.editbox.focus();
        });
    },

    _openCaptureScreenContextMenu(e) {
        App.popupContextMenu(App.createContextMenu([
        {
            label: Lang.chat.captureScreen,
            click: this._handleCaptureScreen
        }, {
            label: Lang.chat.hideCurrentWindowAndCaptureScreen,
            click: () => {
                App.openCaptureScreen('all', true).then(image => {
                    this.editbox.appendImage(image);
                    this.editbox.focus();
                });
            }
        }, {
            type: 'separator'
        }, {
            label: Lang.chat.setCaptureScreenShotcut,
            click: () => {
                let shortcut = null;
                let defaultShortcut = App.user.config.shortcut.captureScreen || 'Ctrl+Alt+Z';
                Modal.show({
                    modal: true,
                    header: Lang.chat.setCaptureScreenShotcut,
                    content: <ShortcutField fullWidth={true} hintText={defaultShortcut} checkGlobal={true} focus={true} onChange={newShortcut => {
                        shortcut = newShortcut;
                    }}/>,
                    width: 360,
                    actions: [{type: 'cancel'}, {type: 'submit', label: Lang.common.confirm}],
                    onSubmit: () => {
                        if(Helper.isNotEmptyString(shortcut) && App.user.config.shortcut.captureScreen !== shortcut) {
                            App.user.config.shortcut.captureScreen = shortcut;
                            App.saveUser();
                            App.chat.registerGlobalHotKey();
                            this.forceUpdate();
                        }
                    }
                });
            }
        }]), e);
    },

    _handleMessageTip() {
        Popover.toggle({
            getLazyContent: () => <MessageTip requestClose={() => {
                Popover.hide('ChatMessageTipPopover');
            }} />,
            contentId: 'chat-' + this.props.chatId,
            id: 'ChatMessageTipPopover',
            removeAfterHide: false,
            trigger: this.messageTipBtn,
            placement: 'top',
            style: {
                width: 350,
                height: 165
            },
            float: 'center'
        });
    },

    componentDidMount() {
        this._handleCaptureScreenGlobalShortcutEvent = App.on(R.event.capture_screen_global, (image, chat) => {
            if(this.props.chatId === chat.gid) {
                this.editbox.appendImage(image);
                this.editbox.focus();
            }
        });
    },

    componentWillUnmount() {
        App.off(this._handleCaptureScreenGlobalShortcutEvent);
    },

    render() {
        const STYLE = {
            main: {
                backgroundColor: Theme.color.canvas,
                height: App.user.config.ui.chat.sendbox.height,
                zIndex: 10
            },
            editbox: {
                padding: 10,
                display: 'block',
                boxSizing: 'border-box',
                position: 'absolute',
                bottom: 48,
                overflowY: 'auto'
            },
            editStyle: {
                padding: 10,
            },
            toolbar: {
                height: 48,
                backgroundColor: Theme.color.pale2
            },
            icon: {
                pointerEvents: 'none'
            },
            fileButtonStyle: {
                cursor: 'pointer',
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                top: 0,
                width: '100%',
                opacity: 0,
                pointerEvents: 'auto'
            },
            fileButtonWrapper: {
                display: 'inline-block',
                position: 'relative'
            }
        };

        let {
            content,
            chatId,
            style,
            placeholder,
            ...other
        } = this.props;

        style = Object.assign({}, STYLE.main, style);
    
        return <div {...other} style={style}>
            <DraftEditor className="dock-full"
              ref={e => {this.editbox = e;}}
              placeholder={placeholder}
              style={STYLE.editbox}
              onPaste={this._handleOnPaste}
              onChange={this._handleOnChange}
              onReturnKeyDown={this._handleOnReturnKeyDown}
            />
            <div className="dock-bottom" style={STYLE.toolbar}>
              <div style={STYLE.fileButtonWrapper} ref={(e) => this.emotionBtn = e}>
                <IconButton className="hint--top" onClick={this._handleEmoticonClick} data-hint={Lang.chat.sendEmoticon}>
                  <EmoticonIcon color={Theme.color.icon} hoverColor={Theme.color.primary1}/>
                </IconButton>
              </div>
              <div style={STYLE.fileButtonWrapper} className="hint--top" data-hint={Lang.chat.sendImage}>
                <input ref={e => this.selectImageFileBtn = e} style={STYLE.fileButtonStyle} onChange={this._handleSelectImageFile} type="file" accept=".png, .jpg, .jpeg, .gif, .bmp"/>
                <IconButton onClick={() => this.selectImageFileBtn.click()}>
                  <ImageIcon color={Theme.color.icon} hoverColor={Theme.color.primary1}/>
                </IconButton>
              </div>
              <div style={STYLE.fileButtonWrapper} className="hint--top" data-hint={Lang.chat.sendFile}>
                <input ref={e => this.selectFileBtn = e} style={STYLE.fileButtonStyle} onChange={this._handleSelectFile} type="file" />
                <IconButton onClick={() => this.selectFileBtn.click()}>
                    <FileIcon color={Theme.color.icon} hoverColor={Theme.color.primary1}/>
                </IconButton>
              </div>
              <div style={STYLE.fileButtonWrapper} className="hint--top" data-hint={Lang.chat.captureScreen + ' (' + App.user.config.shortcut.captureScreen + ')'}>
                <IconButton onClick={this._handleCaptureScreen} onContextMenu={this._openCaptureScreenContextMenu}>
                    <CutIcon color={Theme.color.icon} hoverColor={Theme.color.primary1}/>
                </IconButton>
              </div>
              {App.user.config.ui.chat.hideMessageTip ? null : <div ref={e => this.messageTipBtn = e} style={STYLE.fileButtonWrapper} className="hint--top" data-hint={Lang.chat.messageTip}>
                <IconButton onClick={this._handleMessageTip}>
                    <HelpIcon color={Theme.color.icon} hoverColor={Theme.color.primary1}/>
                </IconButton>
              </div>}
              <div className="dock-right">
                <IconButton disabled={this.state.sendButtonDisabled} className="hint--top-left" onClick={this._handleSendButtonClick} data-hint={Lang.chat.sendMessageTooltip}>
                  <SendIcon color={this.state.sendButtonDisabled ? Theme.color.disabled : Theme.color.primary1} hoverColor={this.state.sendButtonDisabled ? Theme.color.disabled : ColorManipulator.fade(Theme.color.primary1, 0.9)}/>
                </IconButton>
              </div>
            </div>
        </div>
    }
});

export default MessageSendbox;
