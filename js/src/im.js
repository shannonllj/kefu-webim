/*
    im业务逻辑代码
    version: 1.4.0
*/

;(function(window, undefined){
    'use strict';
    

    typeof HTMLAudioElement !== 'undefined' && (HTMLAudioElement.prototype.stop = function() {
        this.pause(); 
        this.currentTime = 0.0; 
    });

    var config;

    var sendQueue = {};//记录消息发送失败


    /*
        main
    */
    var main = function() {
        var groupUser = '';//记录当前技能组对应的webim user
        var isGroupChat = false;//当前是否技能组聊天窗口
        var isGroupOpened = false;//当前是否技能组用户是否连接完毕
        var isShowDirect = false;//不同技能组之间，直接显示
        var curGroup = '';//记录当前技能组，如果父级页面切换技能组，则直接打开chatwindow，不toggle   
        var swfupload = null;//flash 上传利器
        var https = location.protocol == 'https:' ? true : false;
        var click = EasemobWidget.utils.isMobile && ('ontouchstart' in window) 
            ? 'touchstart' 
            : 'click';

        config.root = window.top == window;//是否在iframe当中
        config.json.hide = config.json.hide == 'false' 
            ? false 
            : config.json.hide;
        

        /*
            处理技能组user切换
        */
        var handleGroupUser = function() {

            groupUser 
            ? $.when(
                EasemobWidget.api.getPwd({user: groupUser})
                , EasemobWidget.api.getGroup({
                    user: groupUser
                    , orgName: config.orgName
                    , appName: config.appName
                    , to: config.to
                })
            )
            .done(function(info, group){
                config.user = groupUser;
                config.password = info;
                
                im.chatWrapper.attr('data-group', group);

                im.open(true);

                //每次切换不在重新获取，除非用户trigger           
                if (im.chatWrapper.data('hised')) return;
                
                im.getHistory(0, im.chatWrapper, function(wrapper, info){
                
                    wrapper.attr('data-hised', 1);

                    config.history = info;
                    im.handleHistory(wrapper);

                    im.toggleChatWindow(isShowDirect ? 'show' : '')
                });

            })
            : $.when(EasemobWidget.api.getUser(config))
            .done(function(info){
                config.user = info.userId;
                config.password = info.userPassword;
                
                config.root 
                ? Emc.setcookie(escape(curGroup), config.user) 
                : message.sendToParent('setgroupuser@' + config.user + '@emgroupuser@' + curGroup);

                im.open(true);

                im.toggleChatWindow(isShowDirect ? 'show' : '')
            });
        }


        /*
            监听父级窗口发来的消息
        */
        var message = new EmMessage().listenToParent(function(msg){
            var value;
            if(msg.indexOf('emgroup@') == 0) {//技能组消息
                value = msg.slice(8);
                msg = 'emgroup';
            } else if(msg.indexOf('@') > 0) {//从父级页面cookie读取相关信息
                value = msg.split('@')[1];
                msg = msg.split('@')[0];
            }

            switch(msg) {
                case 'dragend':
                    im.scrollBottom();
                    break;
                case 'imclick'://关闭 或 展开 iframe 聊天窗口
                    isGroupChat = false;
                    if(im && im.loaded) {
                        im.chatWrapper = $('#normal');
                        im.chatWrapper.removeClass('hide').siblings().addClass('hide');
                        if(config.user != im.curUser.user) {
                            config.user = im.curUser.user;
                            config.password = im.curUser.pwd;
                            im.open(true);
                            im.setTitle();
                        }
                        im.group = false;
                        im.toggleChatWindow(curGroup ? 'show' : '');
                    } else {
                        im.toggleChatWindow();
                    }
                    curGroup = '';
                    break;
                case 'emgroup'://技能组
                    isGroupChat = true;
                    isGroupOpened = false; 

                    var idx = value.indexOf('@emgroupuser@');

                    if(idx > 0) {
                        groupUser = value.slice(0, idx);
                    } else {
                        groupUser = null;
                    }
                    value = value.slice(idx + 13);

                    if(curGroup != value) {
                        curGroup = value;
                        isShowDirect = true;
                    } else {
                        isShowDirect = false;
                    }


                    if(im && im.loaded) {
                        im.handleGroup(value);
                        handleGroupUser();
                    }
                    
                    isShowDirect
                    ? im.toggleChatWindow('show')
                    : im.toggleChatWindow()
                    break;
                default: break;
            }
        });


       
        /*
            聊天窗口所有业务逻辑代码
        */
        var im = ({
            
            init: function(){

                this.getDom();//绑定所有相关dom至this
                this.changeTheme();//设置相应主题

                //独立窗口不展示悬浮小按钮
                if(!config.json.hide && !config.root) this.fixedBtn.removeClass('hide');
                //独立页面
                config.root && (
                    this.min.addClass('hide')//隐藏最小化按钮
                    , this.toggleChatWindow()//展示聊天窗口内容
                );
                
                //不支持异步upload的浏览器使用flash插件搞定
                if(!Easemob.im.Utils.isCanUploadFileAsync() && Easemob.im.Utils.isCanUploadFile()) {
                    swfupload = uploadShim('easemobWidgetFileInput');
                    $('object[id^="SWFUpload"]').attr('title', '图片');
                }

                this.fillFace();//遍历FACE，添加所有表情
                this.setWord();//设置广告语
                this.setTitle(config.json.emgroup ? unescape(config.json.emgroup) : '');//设置im.html的标题
                //this.audioAlert();//init audio
                this.mobileInit();//h5 适配，为防止media query不准确，js动态添加class
                this.setOffline();//根据状态展示上下班不同view
                this.sdkInit();//调用js sdk相关api，初始化聊天相关操作

                this.loaded = true;//im ready
                this.handleEvents();//执行post过来的消息，清空事件列表

                this.bindEvents();//开始绑定dom各种事件
                EasemobWidget.utils.isMobile && config.json.emgroup || this.handleHistory();//处理拿到的历史记录
                this.showFixedBtn();//展示悬浮小按钮

                this.getHistory(0, $('#normal'), function(wrapper, info){
                    config.history = info;
                    im.handleHistory(wrapper);
                });

            }
            , getHistory: function(from, wrapper, callback) {
                var me = this;
                wrapper = wrapper || im.chatWrapper;

                if(!wrapper.data('group')) return;

                $.when(EasemobWidget.api.getHistory(
                    from 
                    , EasemobWidget.LISTSPAN
                    , wrapper.data('group')
                    , config.json.tenantId
                ))
                .done(function(info){
                    if(info && info.length == EasemobWidget.LISTSPAN) {
                        wrapper.attr('data-start', Number(info[EasemobWidget.LISTSPAN - 1].chatGroupSeqId) - 1);
                        wrapper.attr('data-history', 0);
                    } else {
                        wrapper.attr('data-history', 1);
                    }
                    callback instanceof Function && callback(wrapper, info);
                });
            }
            , setAttribute: function() {
                this.msgCount = 0;//未读消息数
                this.eventList = [];//事件列表,防止iframe没有加载完，父级元素post过来消息执行出错
                this.scbT = 0;//sroll bottom timeout stamp
                this.autoGrowOptions = {};
                this.historyFirst = true;//第一次获取历史记录
                this.msgTimeSpan = {};//用于处理1分钟之内的消息只显示一次时间
                
                return this;
            }
            , handleEvents: function() {
                this.eventList.length > 0 && this.eventList[0].call(this);
            }
            , handleGroup: function(type) {
                if(typeof type === 'string') {
                    type = unescape(type);
                    im.group = type;
                    im.handleChatContainer(im.group);
                } else {
                    if(!im.group) {
                        type.ext 
                        && type.ext.weichat 
                        && type.ext.weichat.queueName 
                        && delete type.ext.weichat.queueName;

                        return;
                    }
                    type.ext = type.ext || {};
                    type.ext.weichat = type.ext.weichat || {};
                    type.ext.weichat.queueName = im.group;
                }
            }
            , handleChatContainer: function(groupId) {
                var curChatContainer = $(document.getElementById(groupId));

                if(curChatContainer.length > 0) {
                    this.chatWrapper = curChatContainer;
                    this.setTitle(groupId);
                    curChatContainer.removeClass('hide').siblings('.easemobWidget-chat').addClass('hide');
                } else {
                    curChatContainer = $('<div data-start="0" data-history="1" id="' + groupId + '" class="easemobWidget-chat"></div>');
                    this.chatWrapper.parent().prepend(curChatContainer);
                    this.handleChatContainer(groupId);     
                }
            }
            , handleHistory: function(cwrapper){
                var me = this;
                if(config.history && config.history.length > 0) {
               
                    $.each(config.history, function(k, v){
                        
                        var wrapper = cwrapper || this.chatWrapper;
                        
                        var msg = v.body;

                        if(v.body && v.body.bodies.length > 0) {
                            var msg = v.body.bodies[0];
                            if(v.body.from && v.body.from.indexOf('webim-visitor') > -1) {

                                //访客发送的满意度评价不在历史记录中展示
                                if(v.body.ext 
                                && v.body.ext.weichat 
                                && v.body.ext.weichat.ctrlType 
                                && v.body.ext.weichat.ctrlType == 'enquiry') {
                                    return;
                                }

                                switch(msg.type) {
                                    case 'img':
                                        im.sendImgMsg(msg, wrapper);
                                        break;
                                    case 'txt':
                                        im.sendTextMsg(msg, wrapper);
                                        break;
                                }
                            } else {

                                //判断是否为满意度调查的消息
                                if(v.body.ext 
                                && v.body.ext.weichat 
                                && v.body.ext.weichat.ctrlType 
                                && v.body.ext.weichat.ctrlType == 'inviteEnquiry') {
                                    msg = v.body;
                                }

                                im.receiveMsg(msg, msg.type, 'history', wrapper);
                            }

                            /*
                                @param1:
                                @param2(boolean); true: 历史记录
                                @param3(dom); 需要append消息的wrapper 
                            */
                            im.addDate(v.timestamp || v.body.timestamp, true, wrapper);
                        }
                    });

                    //此坑防止第一次获取历史记录图片loaded后，不能滚动到底部
                    if(im.historyFirst) {
                        im.chatWrapper.find('img:last').on('load', im.scrollBottom);
                        im.scrollBottom();
                        im.historyFirst = false;
                    }
                }
            }
            , setTitle: function(title){
                var nickName = this.headBar.find('.easemobWidgetHeader-nickname');
                
                nickName.html(config.tenantName + (title ? '-' + title : ''));
                document.title = nickName.html() + (title ? '' : '-客服');
            }
            , mobileInit: function(){
                if(!EasemobWidget.utils.isMobile) return;
                this.Im.find('.easemobWidget-logo').hide();

                if(!config.json.hide && !config.root) {
                    this.fixedBtn.css({width: '100%', top: '0'});
                    this.fixedBtn.children().css({
                        width: '100%'
                        , 'border-radius': '0'
                        , 'text-align': 'center'
                        , 'font-size': '18px'
                        , 'height': '40px'
                        , 'line-height': '40px'
                    });
                }
                this.evaluate.addClass('hide');
                this.mobileLink.attr('href', location.href);
                this.sendbtn.removeClass('disabled').addClass('easemobWidgetSendBtn-mobile');
                this.satisDialog.addClass('easemobWidget-satisfaction-dialog-mobile');
                this.headBar.addClass('easemobWidgetHeader-mobile');
                this.chatWrapper.parent().addClass('easemobWidgetBody-mobile');
                //this.realfile.addClass('easemobWidgetFileInput-mobile');
                this.faceWrapper.parent().addClass('easemobWidget-face-wrapper-mobile');
                this.facebtn.addClass('easemobWidget-face-mobile');
                $('.easemobWidget-face-bg').addClass('easemobWidget-face-bg-mobile');
                this.uploadbtn.addClass('easemobWidget-file-mobile');
                this.sendbtn.parent().addClass('easemobWidgetSend-mobile');
                this.textarea.addClass('textarea-mobile');
                this.Im.find('.easeWidget-face-rec').addClass('easeWidget-face-rec-mobile');

                if(config.json.emgroup && config.root) {//处理技能组
                    var value = unescape(config.json.emgroup);

                    im.handleGroup(value);

                    groupUser = Emc.getcookie(escape(value));
                    curGroup = value;
                    handleGroupUser();
                }

            }
            , setWord: function(){
                if(config.word) {
                    this.word.find('span').html(Easemob.im.Utils.parseLink(config.word));
                } else {
                    this.word.addClass('hide');
                    this.chatWrapper.parent().css('top', '43px');
                }
            }
            , fillFace: function(){
                var faceStr = '<li class="e-face">',
                    count = 0;

                $.each(Easemob.im.EMOTIONS.map, function(k, v){
                    count += 1;
                    faceStr += "<div class='easemobWidget-face-bg e-face'>\
                                    <img class='easemobWidget-face-img e-face' \
                                        src='"+Easemob.im.EMOTIONS.path + v + "' \
                                        data-value="+k+" />\
                                </div>";

                    if(count % 7 == 0) {
                        faceStr += '</li><li class="e-face">';
                    }
                });

                if(count % 7 == 0) {
                    faceStr = faceStr.slice(0, -('<li class="e-face">').length);
                } else {
                    faceStr += '</li>';
                }

                this.faceWrapper.html(faceStr), faceStr = null;
            }
            , errorPrompt: function(msg) {//暂时所有的提示都用这个方法
                var me = this;
                me.ePrompt.html(msg).removeClass('hide');
                setTimeout(function(){
                    me.ePrompt.html(msg).addClass('hide');
                }, 2000); 
            }
            , changeTheme: function() {
                
                if(config.json.color) {
                    var color = config.json.color;
                    this.min.css('background-color', color);
                    this.fixedBtn.children().css('background-color', color);
                    this.headBar.css('background-color', color);
                    this.sendbtn.css('background-color', color);
                } else if(config.theme) {
                    if(!EasemobWidget.THEME[config.theme]) config.theme = '天空之城';
                    //$('head').append('<link rel="stylesheet" href="/webim/theme/'+encodeURIComponent(config.theme)+'.css" />');
                    $('<style type="text/css">' + EasemobWidget.THEME[config.theme].css + '</style>').appendTo('head');
                } 
            }
            , showFixedBtn: function() {
                !config.json.hide && !config.root && this.fixedBtn.removeClass('hide');
            }
            , setOffline: function() {
                var me = this;
                if(!config.offline) {
                    me.offline.addClass('hide');
                    config.word && me.word.removeClass('hide');
                    me.chatWrapper.parent().removeClass('hide');
                    me.sendbtn.parent().removeClass('hide');
                    me.dutyStatus.html('(在线)');
                    me.headBar.find('.easemobWidgetHeader-bar').removeClass('offline').addClass('online');
                    me.fixedBtn.find('a').removeClass('easemobWidget-offline-bg');
                    return;
                }
                me.fixedBtn.find('a').addClass('easemobWidget-offline-bg');
                me.headBar.find('.easemobWidgetHeader-bar').removeClass('online').addClass('offline');
                me.offline.removeClass('hide');
                me.word.addClass('hide');
                me.chatWrapper.parent().addClass('hide');
                me.sendbtn.parent().addClass('hide');
                me.dutyStatus.html('(离线)');
            }
            , toggleChatWindow: function(windowStatus) {
                var me = this;

                //not ready
                if(!me.loaded) {
                    me.eventList = [];

                    if(isGroupChat) {
                        me.eventList.push(function(){
                            handleGroupUser();
                        });  
                    } else {
                        me.eventList.push(im.toggleChatWindow);
                    }
                    return;
                }

                if(!config.root) {
                    setTimeout(function(){
                        !config.json.hide && me.fixedBtn.toggleClass('hide');
                    }, 100);
                    message.sendToParent(windowStatus == 'show' || me.Im.hasClass('hide') ? 'showChat' : 'minChat');
                    windowStatus == 'show' 
                        ? (
                            me.fixedBtn.removeClass('hide')
                            , me.Im.removeClass('hide')
                        ) 
                        : me.Im.toggleClass('hide');
                } else {
                    me.Im.removeClass('hide');
                }

                if(me.Im.hasClass('hide')) {
                    me.isOpened = false;
                } else {
                    me.textarea.focus();
                    me.isOpened = true;
                    me.scrollBottom();
                }
                me.addPrompt();
            }
            , sdkInit: function(){
                var me = this;
                me.conn = new Easemob.im.Connection({
                    https: https ? true : false
                    , wait: 60
                    , url: (https ? 'https:' : 'http:') + '//im-api.easemob.com/http-bind/'
                });
                me.conn.listen({
                    onOpened: function(){
                        me.conn.setPresence();
                        me.conn.heartBeat(me.conn);

                        isGroupChat && (isGroupOpened = true);
                        while(sendQueue[curGroup] && sendQueue[curGroup].length) {
                            me.conn.send(sendQueue[curGroup].pop());
                        }
                    }
                    , onTextMessage: function(message){
                        me.receiveMsg(message, 'txt');
                    }
                    , onEmotionMessage: function(message){
                        me.receiveMsg(message, 'face');
                    }
                    , onPictureMessage: function(message){
                        me.receiveMsg(message, 'img');
                    }
                    , onLocationMessage: function(message){
                        me.receiveMsg(message, 'location');
                    }
                    , onAudioMessage: function(message) {
                        me.receiveMsg(message, 'audio');
                    }
                    , onClosed: function() {
                        me.open();
                    }
                    , onError: function(e){
                        me.conn.stopHeartBeat(me.conn);
                        
                        while(sendQueue[curGroup] && sendQueue[curGroup].length) {
                            me.conn.send(sendQueue[curGroup].pop());
                        }

                        switch(e.type){
                            case 1://offline
                                me.open();
                            case 3://signin failed
                            case 7://unknow
                                if(me.conn.isOpened()) {
                                    me.conn.close();
                                } else if(me.conn.isClosed() || me.conn.isClosing()) {
                                    me.open();
                                }
                                break;
                            case 8://conflict
                                break;
                            default:
                                break;
                        }
                    }
                });
                me.curUser = {
                    user: config.user
                    , pwd: config.password
                };
                EasemobWidget.utils.isMobile && config.json.emgroup || me.open();
            }
            , addDate: function(date, isHistory, wrapper) {
                var htmlPre = '<div class="easemobWidget-date">',
                    htmlEnd = '</div>',
                    fmt = 'M月d日 hh:mm';

                wrapper = wrapper || this.chatWrapper;

                var id = wrapper.attr('id');

                if(!!date) {
                    $(htmlPre + new Date(date).format(fmt) + htmlEnd)
                    .insertAfter(wrapper.find('div:first')); 
                } else if(!isHistory) {
                    if(!this.msgTimeSpan[id] 
                    || (new Date().getTime() - this.msgTimeSpan[id] > 60000)) {//间隔大于1min  show

                        wrapper.append(htmlPre + new Date().format(fmt) + htmlEnd); 
                    }
                    this.resetSpan(id);
                }
            }
            , resetSpan: function(id) {
                this.msgTimeSpan[id] = new Date().getTime();
            }
            , open: function(force){
                
                var me = this;
                

                if(force) {
                    if(me.conn.isOpening() || me.conn.isOpened()) {
                        me.conn.close();
                    } else {
                        me.open();
                    }
                } else if(!me.conn.isOpening() && !me.conn.isOpened()){
                    me.conn.open({
                        user : config.user
                        , pwd : config.password
                        , appKey : config.appkey
                    });
                }
            }
            , getDom: function(){
                this.offline = $('#easemobWidgetOffline');
                this.leaveMsgBtn = this.offline.find('button');
                this.contact = this.offline.find('input');
                this.leaveMsg = this.offline.find('textarea');
                this.fixedBtn = $('#easemobWidgetPopBar');
                this.Im = $('.easemobWidgetWrapper');
                this.audio = $('audio').get(0);
                this.chatWrapper = this.Im.find('.easemobWidget-chat');
                this.textarea = this.Im.find('.easemobWidget-textarea');
                this.sendbtn = this.Im.find('#easemobWidgetSendBtn');
                this.evaluate = this.sendbtn.parent().find('.easemobWidget-satisfaction');
                this.facebtn = this.Im.find('.easemobWidget-face');
                this.uploadbtn = this.Im.find('#easemobWidgetFile');
                this.realfile = this.Im.find('#easemobWidgetFileInput');
                this.faceWrapper = this.Im.find('.easemobWidget-face-container');
                this.headBar = this.Im.find('#easemobWidgetHeader');
                this.min = this.Im.find('.easemobWidgetHeader-min');
                this.closeWord = this.Im.find('.easemobWidget-word-close');
                this.word = this.Im.find('.easemobWidget-word');
                this.messageCount = this.fixedBtn.find('.easemobWidget-msgcount');
                this.ePrompt = this.Im.find('.easemobWidget-error-prompt');
                this.mobileLink = this.Im.find('#easemobWidgetLink');
                this.dutyStatus = this.Im.find('.easemobWidgetHeader-word-status');
                this.satisDialog = this.Im.find('.easemobWidget-satisfaction-dialog');
            }
            , audioAlert: function(){
                var me = this;
                if(window.HTMLAudioElement && this.audio) {
                    me.playaudio = function(){
                        !EasemobWidget.utils.isMobile &&  me.audio.play();
                    }
                }
            }
            , face: function(msg){
                var me = this;
                if($.isArray(msg)){
                    msg = '[' + msg[0] + ']';
                }
                else if(/\[.*\]/.test(msg)){
                    msg = msg.replace(/&amp;/g, '&');
                    msg = msg.replace(/&#39;/g, '\'');
                    msg = msg.replace(/&lt;/g, '\<');
                    $.each(Easemob.im.EMOTIONS.map, function(k, v){
                        while(msg.indexOf(k) >= 0){
                            msg = msg.replace(k
                                , '<img class=\"chat-face-all\" src=\"' + Easemob.im.EMOTIONS.path + Easemob.im.EMOTIONS.map[k] + '\">');
                        }
                    });
                }
                return msg;
            }
            , toggleFaceWrapper: function(e){
                var h = im.sendbtn.parent().outerHeight();
                im.faceWrapper.parent().css('bottom', h + 'px').toggleClass('hide');
                return false;
            }
            , bindEvents: function(){
                var me = this;

                //防止点击前进后退cache 导致的offline
                if('onpopstate' in window) {
                    $(window).on('popstate', me.open);
                }
                

                /*
                    resend
                */
                me.Im.on(click, '.easemobWidget-msg-status', function(){
                    var that = $(this),
                        w = that.parent().parent(),
                        id = w.attr('id');

                    that.addClass('hide');
                    w.find('.easemobWidget-msg-loading').removeClass('hide');
                    me.send(id);
                });                

                /*
                    drag
                */
                me.headBar.find('.js_drag').on('mousedown', function(e){
                    var ev = e.originalEvent;
                    me.textarea.blur();//ie a  ie...
                    message.sendToParent('dragready' + ev.clientX + '&' + ev.clientY);
                    return false;
                }).on('mouseup', function(){
                    message.sendToParent('dragend');
                    return false;
                });
                

                /*
                    满意度调查
                */
                me.evaluate.on(click, function(){
                    //clear cache
                    me.satisDialog.get(0).inviteId = '';
                    me.satisDialog.get(0).serviceSessionId = '';

                    me.satisDialog.removeClass('hide');
                });
                me.Im.on(click, '.easemobWidget-satisfy-btn button', function(){
                    var that = $(this);

                    //cache
                    me.satisDialog.get(0).inviteId = that.data('inviteid');
                    me.satisDialog.get(0).serviceSessionId = that.data('servicesessionid');

                    me.satisDialog.removeClass('hide');
                    return false;
                });
                me.satisDialog.on(click, 'i, .js_cancel', function(){
                    me.satisDialog.addClass('hide');
                });
                me.satisDialog.on(click, '.js_satisfy', function(){
                    var suc = me.satisDialog.find('.js_suc'),
                        level = me.satisDialog.find('li.sel').length,
                        text = me.satisDialog.find('textarea');

                    if(level == 0) {
                        me.errorPrompt('请先选择星级');
                        return false;
                    }
                    me.sendSatisfaction(level, text.val());

                    suc.removeClass('hide');

                    setTimeout(function(){
                        text.val('');

                        $.each(me.satisDialog.find('li.sel'), function(k, v){
                            $(v).removeClass('sel');
                        });

                        suc.addClass('hide');
                        me.satisDialog.addClass('hide');
                    }, 3000);

                });
                me.satisDialog.on(click, 'li', function(e){
                    e.originalEvent.preventDefault && e.originalEvent.preventDefault();

                    var that = $(this),
                        par = that.parent(),
                        temp = par.find('li');

                    for(var i=0;i<5;i++) {
                        if(i <= that.index()) {
                            temp.eq(i).addClass('sel');
                        } else {
                            temp.eq(i).removeClass('sel');
                        }
                    }

                    e.originalEvent.stopPropagation && e.originalEvent.stopPropagation();
                });


                //关闭广告语按钮
                me.closeWord.on(click, function(){
                    me.word.fadeOut();
                    me.chatWrapper.parent().css('top', '43px');
                });

                //autogrow  callback
                me.autoGrowOptions.callback = function() {
                    var h = im.sendbtn.parent().outerHeight();
                    im.faceWrapper.parent().css('bottom', h + 'px');
                };

                EasemobWidget.utils.isMobile && me.textarea.autogrow(me.autoGrowOptions);
                
                //
                me.textarea.on('keyup change', function(){
                    $(this).val() ? me.sendbtn.removeClass('disabled') : me.sendbtn.addClass('disabled');
                })
                .on('touchstart', function(){//防止android部分机型滚动条常驻，看着像bug ==b
                    me.scrollBottom(800);
                    me.textarea.css('overflow-y', 'auto');
                })
                .on('blur', function(){});

                EasemobWidget.utils.isMobile && me.textarea.on('input', function(){
                    me.autoGrowOptions.update();
                    me.scrollBottom(800);
                });

                //最小化按钮的多态
                me.min.on('mouseenter mouseleave', function(){
                    $(this).toggleClass('hover-color');
                }).on('click', function(e){
                    me.toggleChatWindow();
                    return false;
                });

                //表情的展开和收起
                me.facebtn.on(click, me.toggleFaceWrapper);

                //表情的选中
                me.faceWrapper.on(click, '.easemobWidget-face-bg', function(e){
                    e.originalEvent.preventDefault && e.originalEvent.preventDefault();

                    !EasemobWidget.utils.isMobile && me.textarea.focus();
                    me.textarea.val(me.textarea.val()+$(this).find('img').data('value'));
                    if(EasemobWidget.utils.isMobile){
                        me.autoGrowOptions.update();//update autogrow
                        setTimeout(function(){
                            me.textarea.get(0).scrollTop = 10000;
                        }, 100);
                    }
                    me.sendbtn.removeClass('disabled');

                    e.originalEvent.stopPropagation && e.originalEvent.stopPropagation();
                });

                //悬浮小按钮的点击事件
                me.fixedBtn.find('a').on('click', function(){
                    if(EasemobWidget.utils.isMobile) {
                        $(this).attr({
                            target: '_blank'
                            , href: location.href
                        });
                    } else {
                        me.chatWrapper.removeClass('hide').siblings().addClass('hide');
                        me.toggleChatWindow();
                        me.scrollBottom();
                    }
                });

                //选中文件并发送
                me.realfile.on('change', function(){
                    me.sendImgMsg();
                })
                .on('click', function(){
                    if(!Easemob.im.Utils.isCanUploadFile()) {
                        me.errorPrompt('当前浏览器不支持发送图片');
                        return false;    
                    }
                });

                //hide face wrapper
                $(document).on(click, function(ev){
                    var e = window.event || ev,
                        t = $(e.srcElement || e.target);

                    if(!t.hasClass('e-face')) {
                        me.faceWrapper.parent().addClass('hide');
                    }
                });

                //主要用于移动端触发virtual keyboard的收起
                $('.e-face, .easemobWidgetBody-wrapper')
                .on('touchstart', function(e){
                    me.textarea.blur();

                    //此坑用于防止android部分机型滚动条常驻，看着像bug ==b
                    !me.textarea.val() && me.textarea.css('overflow-y', 'hidden');
                });

                //弹出文件选择框
                me.uploadbtn.on('click', function(){
                    if(!Easemob.im.Utils.isCanUploadFile()) {
                        me.errorPrompt('当前浏览器不支持发送图片');
                        return false;    
                    }
                    
                    me.realfile.click();
                });

                //hot key
                me.textarea.on("keydown", function(evt){
                    var that = $(this);
                    if((EasemobWidget.utils.isMobile && evt.keyCode == 13) 
                        || (evt.ctrlKey && evt.keyCode == 13) 
                        || (evt.shiftKey && evt.keyCode == 13)) {

                        that.val($(this).val()+'\n');
                        return false;
                    } else if(evt.keyCode == 13) {
                        me.faceWrapper.parent().addClass('hide');
                        if(me.sendbtn.hasClass('disabled')) {
                            return false;
                        }
                        me.sendTextMsg();
                        setTimeout(function(){
                            that.val('');
                        }, 0);
                    }
                });

                //不能用touch，无法触发focus
                me.sendbtn.on('click', function(){
                    if(me.sendbtn.hasClass('disabled')) {
                        return false;
                    }
                    me.faceWrapper.parent().addClass('hide');
                    me.sendTextMsg();
                    me.textarea.css({
                        height: '34px'
                        , overflowY: 'hidden'
                    }).focus();
                });

                //
                me.leaveMsgBtn.on(click, function(){
                    if(!me.contact.val() && !me.leaveMsg.val()) {
                        me.errorPrompt('联系方式和留言不能为空');
                    } else if(!me.contact.val()) {
                        me.errorPrompt('联系方式不能为空');
                    } else if(!me.leaveMsg.val()) {
                        me.errorPrompt('留言不能为空');
                    } else if(!/^\d{5,11}$/g.test(me.contact.val()) 
                        && !/^[a-zA-Z0-9-_]+@([a-zA-Z0-9-]+[.])+[a-zA-Z]+$/g.test(me.contact.val())) {
                        me.errorPrompt('请输入正确的手机号码/邮箱/QQ号');
                    } else {
                        var opt = {
                            to: config.to
                            , msg: '手机号码/邮箱/QQ号：' + me.contact.val() + '   留言：' + me.leaveMsg.val()
                            , type : 'chat'
                        }
                        me.handleGroup(opt);
                        me.send(opt);
                        //me.errorPrompt('留言成功');
                        var succeed = me.leaveMsgBtn.parent().find('.easemobWidget-leavemsg-success');
                        succeed.removeClass('hide');
                        setTimeout(function(){
                            succeed.addClass('hide');
                        }, 2000);
                        me.contact.val('');
                        me.leaveMsg.val('');
                    }
                });

                //pc 和 wap 的上划加载历史记录的方法
                var st, memPos = 0, _startY, _y, touch, DIS=200, _fired=false;
                var triggerGetHistory = function(){
                    
                    me.chatWrapper.attr('data-history') != 1 
                    && $.when(EasemobWidget.api.getHistory(
                        me.chatWrapper.attr('data-start')
                        , EasemobWidget.LISTSPAN
                        , me.chatWrapper.data('group')
                        , config.json.tenantId
                    ))
                    .done(function(info){

                        if(info && info.length == EasemobWidget.LISTSPAN) {
                            var start = Number(info[EasemobWidget.LISTSPAN - 1].chatGroupSeqId) - 1;
                            start == 0 && setTimeout(function() {
                                me.chatWrapper.attr('data-history', 1);
                            }, 0);
                            me.chatWrapper.attr('data-start', start);
                            me.chatWrapper.attr('data-history', 0);
                        } else {
                            setTimeout(function() {
                                me.chatWrapper.attr('data-history', 1);
                            }, 0);
                        }
                        config.history = info;
                        im.handleHistory();
                    });
                }

                //wap
                me.chatWrapper.parent().on('touchstart', function(e){
                    var touch = e.originalEvent.touches;
                    if(e.originalEvent.touches && e.originalEvent.touches.length>0) {
                        _startY = touch[0].pageY;
                    }
                })
                .on('touchmove', function(e){
                    var $t = $(this);
                    var touch = e.originalEvent.touches;
                    if(e.originalEvent.touches && e.originalEvent.touches.length>0) {

                        touch = e.originalEvent.touches;
                        _y = touch[0].pageY;
                        if(_y-_startY > 8 && $t.scrollTop() <= 50) {
                            clearTimeout(st);
                            st = setTimeout(function(){
                                triggerGetHistory();
                            }, 100);
                        }
                    }
                });

                //pc
                me.Im.on('mousewheel DOMMouseScroll', '.easemobWidget-chat', function(e){
                    var $t = $(this);
                    
                    if(e.originalEvent.wheelDelta / 120 > 0 || e.originalEvent.detail < 0) {//up
                        clearTimeout(st);
                        st = setTimeout(function(){
                            if(Math.abs($t.offset().top) <= 100) {
                                triggerGetHistory();
                            }
                        }, 400);
                    }
                });
            }
            , scrollBottom: function(type){
                var ocw = im.chatWrapper.parent().get(0);
                
                type 
                ? (clearTimeout(this.scbT), this.scbT = setTimeout(function(){
                    ocw.scrollTop = ocw.scrollHeight - ocw.offsetHeight + 10000;
                }, type))
                : (ocw.scrollTop = ocw.scrollHeight - ocw.offsetHeight + 10000);
            }
            , sendImgMsg: function(msg, wrapper, filename, msgId) {
                var me = this;
                wrapper = wrapper || me.chatWrapper;

                if(msg) {
                    var temp = $("\
                        <div class='easemobWidget-right'>\
                            <div class='easemobWidget-msg-wrapper'>\
                                <i class='easemobWidget-right-corner'></i>\
                                <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                                <div class='easemobWidget-msg-container'>\
                                    <a href='"+msg.url+"' target='_blank'><img src='"+msg.url+"'/></a>\
                                </div>\
                            </div>\
                        </div>\
                    ");
                    wrapper.prepend(temp);
                    return;
                }

                var msgid = msgId || me.conn.getUniqueId();
                if(Easemob.im.Utils.isCanUploadFileAsync()) {
                    if(!me.realfile.val()) return;

                    var file = Easemob.im.Utils.getFileUrl(me.realfile.attr('id'));

                    var temp = $("\
                        <div id='" + msgid + "' class='easemobWidget-right'>\
                            <div class='easemobWidget-msg-wrapper'>\
                                <i class='easemobWidget-right-corner'></i>\
                                <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                                <div class='easemobWidget-msg-loading'>" + EasemobWidget.LOADING +"</div>
                                <div class='easemobWidget-msg-container'>\
                                    <a href='"+file.url+"' target='_blank'><img src='"+file.url+"'/></a>\
                                </div>\
                            </div>\
                        </div>\
                    ");
                    
                }

                var opt = {
                    id: msgid 
                    , fileInputId: me.realfile.attr('id')
                    , apiUrl: (https ? 'https:' : 'http:') + '//a1.easemob.com'
                    , to: config.to
                    , type : 'chat'
                    , filename: file && file.filename || filename || ''
                    , ext: {
                        messageType: 'img'
                    }
                    , onFileUploadError : function(error) {
                        //显示图裂，无法重新发送
                        if(!Easemob.im.Utils.isCanUploadFileAsync()) {
                            swfupload && swfupload.settings.upload_error_handler();
                        } else {
                            setTimeout(function() {
                                var id = error.id,
                                    w = $('#' + id),
                                    img = w.find('img:last');

                                img.parent().attr('href', 'javascript:;');
                                img.attr('src', config.domain + '/webim/resources/unimage@2x.png');
                                w.find('.easemobWidget-msg-loading').addClass('hide');
                                me.scrollBottom();
                            }, 0);
                        }
                    }
                    , onFileUploadComplete: function(data){
                        me.chatWrapper.find('img:last').on('load', im.scrollBottom);
                    }
                    , success: function(id) {
                        $('#' + id).find('.easemobWidget-msg-loading').addClass('hide');
                        me.addDate();
                    }
                    , fail: function(id) {
                        var msg = $('#' + id);

                        msg.find('.easemobWidget-msg-loading').addClass('hide');
                        msg.find('.easemobWidget-msg-status').removeClass('hide');
                    }
                    , flashUpload: Easemob.im.Utils.isCanUploadFileAsync() ? null : flashUpload
                };
                me.handleGroup(opt);
                me.send(opt);
                me.chatWrapper.append(temp);
                me.chatWrapper.find('img:last').on('load', me.scrollBottom);
            }
            , encode: function(str){
                if (!str || str.length == 0) return "";
                var s = "";
                s = str.replace(/&/g, "&amp;");
                s = s.replace(/<(?=[^o][^)])/g, "&lt;");
                s = s.replace(/>/g, "&gt;");
                //s = s.replace(/\'/g, "&#39;");
                s = s.replace(/\"/g, "&quot;");
                s = s.replace(/\n/g, "<br>");
                return s;
            }
            , sendTextMsg: function(msg, wrapper){
                var me = this;
                wrapper = wrapper || me.chatWrapper;

                if(msg) {
                    wrapper.prepend("\
                        <div class='easemobWidget-right'>\
                            <div class='easemobWidget-msg-wrapper'>\
                                <i class='easemobWidget-right-corner'></i>\
                                <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                                <div class='easemobWidget-msg-loading hide'>" + EasemobWidget.LOADING +"</div>
                                <div class='easemobWidget-msg-container'>\
                                    <p>"+Easemob.im.Utils.parseLink(me.face(me.encode(msg.msg)))+"</p>\
                                </div>\
                            </div>\
                        </div>\
                    ");
                    return;
                }

                if(!me.textarea.val()) {
                    return;
                }
                var txt = me.textarea.val();
                

                var msgid = me.conn.getUniqueId();
                //local append
                wrapper.append("\
                    <div id='" + msgid + "' class='easemobWidget-right'>\
                        <div class='easemobWidget-msg-wrapper'>\
                            <i class='easemobWidget-right-corner'></i>\
                            <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                            <div class='easemobWidget-msg-loading'>" + EasemobWidget.LOADING +"</div>
                            <div class='easemobWidget-msg-container'>\
                                <p>"+Easemob.im.Utils.parseLink(me.face(me.encode(txt)))+"</p>\
                            </div>\
                        </div>\
                    </div>\
                ");
                me.textarea.val('');
                me.scrollBottom();

                var opt = {
                    id: msgid
                    , to: config.to
                    , msg: txt
                    , type : 'chat'
                    , success: function(id) {
                        $('#' + id).find('.easemobWidget-msg-loading').addClass('hide');
                        me.addDate();
                    }
                    , fail: function(id) {
                        var msg = $('#' + id);

                        msg.find('.easemobWidget-msg-loading').addClass('hide');
                        msg.find('.easemobWidget-msg-status').removeClass('hide');
                    }
                }
                me.handleGroup(opt);
                me.send(opt);
            }
            , send: function(option) {
                var me = this,
                    resend = typeof option == 'string',
                    id = resend ? option : option.id;

                if(!resend) {
                    sendQueue[curGroup] || (sendQueue[curGroup] = []);
                }

                if(isGroupChat && !isGroupOpened) {
                    resend || sendQueue[curGroup].push(option);
                } else {
                    me.conn.send(option);
                }
            }
            , sendSatisfaction: function(level, content) {
                var me = this;
                
                var opt = {
                    to: config.to
                    , msg: ''
                    , type : 'chat'
                    , ext: {
                        weichat: {
                            ctrlType: 'enquiry'
                            , ctrlArgs: {
                                inviteId: me.satisDialog.get(0).inviteId || ''
                                , serviceSessionId: me.satisDialog.get(0).serviceSessionId || ''
                                , detail: content
                                , summary: level
                            }
                        }
                    }
                }

                this.handleGroup(opt);
                
                this.send(opt);
            }
            , addPrompt: function(detail){//未读消息提醒，以及让父级页面title滚动
                if(!this.isOpened && this.msgCount > 0) {
                    if(this.msgCount > 9) {
                        this.messageCount.addClass('mutiCount').html('...');
                    } else {
                        this.messageCount.removeClass('mutiCount').html(this.msgCount);
                    }
                    message.sendToParent('msgPrompt');
                    this.notify(detail || '');
                } else {
                    this.msgCount = 0;
                    this.messageCount.html('').addClass('hide');
                    message.sendToParent('recoveryTitle');
                }
            }
            , notify: function(detail) {
                message.sendToParent('notify' + (detail || ''));
            }
            , receiveMsg: function(msg, type, isHistory, wrapper){
                var me = this;
                var value = '', msgDetail = '';
                
                wrapper = wrapper || me.chatWrapper;


                //满意度评价
                
                if(msg.ext 
                && msg.ext.weichat 
                && msg.ext.weichat.ctrlType 
                && msg.ext.weichat.ctrlType == 'inviteEnquiry') {
                    type = 'satisfactionEvaluation';  
                }

                //me.playaudio();
                switch(type){
                    case 'txt':
                        msgDetail = msg.msg || msg.data;
                        msgDetail = (msgDetail.length > 30 ? msgDetail.slice(0, 30) + '...' : msgDetail);
                        value = me.face(Easemob.im.Utils.parseLink(me.encode(isHistory ? msg.msg : msg.data)));
                        value = '<p>' + value + '</p>';
                        break;
                    case 'face':
                        msgDetail = '';
                        $.each(msg.data, function(k, v){
                            v.data = v.data.replace(/>/g, "&gt;");
                            msgDetail += v.data;
                            if(0 > v.data.indexOf('data:image')) {
                                value += v.data;
                            } else {
                                value += '<img class="chat-face-all" src="'+v.data+'">';   
                            }
                        });
                        msgDetail = (value.length > 30 ? value.slice(0, 30) + '...' : value);
                        value = '<p>' + value + '</p>';
                        value = Easemob.im.Utils.parseLink(value);
                        break;
                    case 'img':
                        value = '<a href="'+msg.url+'" target="_blank"><img src="'+(msg.thumb || msg.url)+'"></a>';   
                        msgDetail = '[图片]';
                        break;
                    case 'satisfactionEvaluation':
                        value = '<p>请对我的服务做出评价</p>'
                        msgDetail = '请对我的服务做出评价';
                    default: break;
                }
                
                var temp = "\
                    <div class='easemobWidget-left'>\
                        <div class='easemobWidget-msg-wrapper'>\
                            <i class='easemobWidget-left-corner'></i>\
                            <div class='easemobWidget-msg-container'>" + value +"</div>\
                            <div class='easemobWidget-msg-status hide'><i></i><span>发送失败</span></div>\
                        </div>"
                        + (type == 'satisfactionEvaluation'
                        ? '<div class="easemobWidget-satisfy-btn">\
                                <button data-inviteid="' + msg.ext.weichat.ctrlArgs.inviteId + '" data-servicesessionid="' + msg.ext.weichat.ctrlArgs.serviceSessionId + '">立即评价</button>\
                           </div>'
                        : '') +
                    "</div>";
                
                
                if(!isHistory) {
                    wrapper.append(temp);
                    me.addDate();
                    me.resetSpan();
                    me.scrollBottom();
                } else {
                    wrapper.prepend(temp);
                }
                if(!isHistory) {
                    if(!me.isOpened) {
                        me.messageCount.html('').removeClass('hide');
                        me.msgCount += 1;
                        me.addPrompt(msgDetail);
                    } else if(EasemobWidget.utils.isMin()) {
                        me.notify(msgDetail);
                    }
                }
            }
        }.setAttribute());
        
        EasemobWidget.getInfoFromApi(config, function() {
            im.init.call(im);
        });



        /*
            upload by flash
            param1: input file ID
        */
        var uploadShim = function(fileInputId) {
            if(!Easemob.im.Utils.isCanUploadFile()) {
                return;
            }
            var pageTitle = document.title;
            var uploadBtn = $('#' + fileInputId);
            if(typeof SWFUpload === 'undefined' || uploadBtn.length < 1) return;

            return new SWFUpload({ 
                file_post_name: 'file'
                , flash_url: "js/swfupload/swfupload.swf"
                , button_placeholder_id: fileInputId
                , button_width: uploadBtn.width() || 120
                , button_height: uploadBtn.height() || 30
                , button_cursor: SWFUpload.CURSOR.HAND
                , button_window_mode: SWFUpload.WINDOW_MODE.TRANSPARENT
                , file_size_limit: 10485760
                , file_upload_limit: 0
                , file_queued_handler: function(file) {
                    if(this.getStats().files_queued > 1) {
                        this.cancelUpload();
                    }
                    if(!EasemobWidget.PICTYPE[file.type.slice(1).toLowerCase()]) {
                        im.errorPrompt('不支持此文件类型' + file.type);
                        this.cancelUpload();
                    } else if(10485760 < file.size) {
                        im.errorPrompt('文件大小超过限制！请上传大小不超过10M的文件');
                        this.cancelUpload();
                    } else {
                        this.fileMsgId = im.conn.getUniqueId();
                        im.sendImgMsg(null, null, file.name, this.fileMsgId);
                    }
                }
                , file_dialog_start_handler: function() {}
                , upload_error_handler: function(file, code, msg){
                    if(code != SWFUpload.UPLOAD_ERROR.FILE_CANCELLED
                    && code != SWFUpload.UPLOAD_ERROR.UPLOAD_LIMIT_EXCEEDED 
                    && code != SWFUpload.UPLOAD_ERROR.FILE_VALIDATION_FAILED) {
                        var temp = $("\
                            <div class='easemobWidget-right'>\
                                <div class='easemobWidget-msg-wrapper'>\
                                    <i class='easemobWidget-right-corner'></i>\
                                    <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                                    <div class='easemobWidget-msg-container'>\
                                        <a href='javascript:;'><img src='"+config.domain + "/webim/resources/unimage@2x.png'/></a>\
                                    </div>\
                                </div>\
                            </div>\
                        ");
                        im.chatWrapper.append(temp);
                        im.chatWrapper.find('img:last').on('load', im.scrollBottom);
                    }
                }
                , upload_complete_handler: function(){}
                , upload_success_handler: function(file, response){
                    if(!file || !response) return;
                    try{
                        var res = Easemob.im.Utils.parseUploadResponse(response);
                        
                        res = $.parseJSON(res);
                        if(file && !file.url && res.entities && res.entities.length > 0) {
                            file.url = res.uri + '/' + res.entities[0].uuid;
                        }
                        var temp = $("\
                            <div id='" + this.fileMsgId + "' class='easemobWidget-right'>\
                                <div class='easemobWidget-msg-wrapper'>\
                                    <i class='easemobWidget-right-corner'></i>\
                                    <div class='easemobWidget-msg-status hide'><span>发送失败</span><i></i></div>\
                                    <div class='easemobWidget-msg-loading'>" + EasemobWidget.LOADING +"</div>
                                    <div class='easemobWidget-msg-container'>\
                                        <a href='"+file.url+"' target='_blank'><img src='"+file.url+"'/></a>\
                                    </div>\
                                </div>\
                            </div>\
                        ");
                        im.chatWrapper.append(temp);
                        im.chatWrapper.find('img:last').on('load', im.scrollBottom);
                        this.uploadOptions.onFileUploadComplete(res);
                    } catch (e) {
                        im.errorPrompt('上传图片发生错误');
                    }
                }
            });
        }

        /*
            提供上传接口
        */
        var flashUpload = function(url, options){
            swfupload.setUploadURL(url);
            swfupload.startUpload();
            swfupload.uploadOptions = options;
        }
    }

    //ie8的iframe的cache实在是。。。#￥%&&, 不得不跟父级通信
    window.top == window 
    ? (
        config = EasemobWidget.utils.getConfig(),
        main()
    )
    : new EmMessage().listenToParent(function(msg){
        
        if(msg.indexOf('initdata:') == 0) {
            config = EasemobWidget.utils.getConfig(msg.slice(9));
            main();
        }
    });
}(window, undefined));























/***********************************************/
/*
case 'audio':
    var options = msg;
    options.onFileDownloadComplete = function(response, xhr) {
        var audio = document.createElement('audio');
        if (Easemob.im.Helper.isCanUploadFileAsync && ("src" in audio) && ("controls" in audio)) {
            var objectURL = window.URL.createObjectURL(response);
            audio = null;
            var temp = "\
                <div class='easemobWidget-left'>\
                    <div class='easemobWidget-msg-wrapper'>\
                        <i class='easemobWidget-left-corner'></i>\
                        <div class='easemobWidget-msg-container'>\
                            <i class='easemobWidget-msg-voice'></i>\
                            <audio src='"+objectURL+"' controls class='hide'/>\
                        </div>\
                        <div class='easemobWidget-msg-status hide'><i></i><span>发送失败</span></div>\
                    </div>\
                </div>";
            me.chatWrapper.append(temp);
            me.scrollBottom();
        } else {
            var temp = "\
                <div class='easemobWidget-left'>\
                    <div class='easemobWidget-msg-wrapper'>\
                        <i class='easemobWidget-left-corner'></i>\
                        <div class='easemobWidget-msg-container'>\
                            <i class='easemobWidget-msg-voice' data-id=''></i>\
                            <audio id='' class='hide' src='' controls/>\
                        </div>\
                        <div class='easemobWidget-msg-status hide'><i></i><span>发送失败</span></div>\
                    </div>\
                </div>";
            me.chatWrapper.append(temp);
            me.scrollBottom();
            audio = null;
        }
    };
    options.onFileDownloadError = function(e) {
        //appendMsg(from, contactDivId, e.msg + ",下载音频" + filename + "失败");
    };
    options.headers = {
        "Accept" : "audio/mp3"
    };
    Easemob.im.Helper.download(options);
    return ;
case 'location':
    value = "\
            <div class='easemobWidget-msg-mapinfo'>" + msg.addr + "</div>\
            <img class='easemobWidget-msg-mapico' src='theme/map.png' />";
    break;
***********************************************
var ts = 0;
me.chatWrapper.on('click', '.easemobWidget-msg-voice', function(){
    if(!Easemob.im.Helper.isCanUploadFileAsync || EasemobWidget.utils.isAndroid) {
        me.errorPrompt('当前浏览器不支持语音播放');
        return false;    
    }
    
    var $t = $(this),
        $a = $t.next(),
        aud = $a.get(0),
        cur = 0;
    var clear = function(){
        clearInterval(ts);
        $t.removeClass('one');
        $t.removeClass('two');
    }
    if(!aud.paused && !aud.ended && 0 < aud.currentTime) {
        aud.stop();
        clear();
        return false;
    }
    aud.play();
    $a.on('ended', function(){
        clear();
    });
    ts = setInterval(function(){
        cur += 1;
        switch(cur % 3) {
            case 0:
                $t.removeClass('two');
                break;
            case 1:
                $t.addClass('one');
                break;
            case 2:
                $t.removeClass('one');
                $t.addClass('two');
                break;
        }
        cur == 9999 && (cur = 0);
    }, 500);
});
*/
