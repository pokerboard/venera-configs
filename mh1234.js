/**
 * 漫画1234 漫画源（Venera）—— 修复版
 *
 * 为什么原来的脚本不能用了：
 *   原脚本依赖 b.amh1234.com 这套旧版 CMS。该域名已经过期并被停放，
 *   现在 302 到 ww17.amh1234.com 再跳到广告页，同族的 mh1234.com /
 *   ymh1234.com / gmh1234.com 也全部失效。站点本体已经整体迁移到
 *   wmh1234.com 的移动端模板（mint），旧的选择器（div.imgBox /
 *   li.list-comic / #total-page / .chapter-warp / var chapterImages）
 *   在现站上一个都不存在，所以只能按新模板重写。
 *
 * 现站结构：
 *   - 首页 /            推荐位 .mint-feature、更新 .mint-update-card、发现 .mint-cover-card
 *   - 分类 /category    可叠加 /tags/{id} /finish/{0,1,2} /order/{hits,id,addtime} /page/{n}
 *   - 搜索 /search/{kw} 与 /search/{kw}/{n}
 *   - 详情 /comic/{comicId}.html        章节内联在 .mint-chapter-grid a[data-chapter-id]
 *   - 阅读 /comic/{cid}/{eid}.html  ->  /go/{token}  ->  reader.hqread.cc/r/{token}
 *   - 图片 CDN wmh1234.wszwhg.net，直链，无防盗链
 *
 * 与原脚本的对应关系：
 *   explore / category / search / comic.loadInfo / comic.loadEp 一一保留，
 *   另外补了同族域名自动切换、章节页跳转兜底、图片正则兜底。
 */

class MH1234 extends ComicSource {
    // name of the source
    name = "漫画1234"

    // unique id of the source
    key = "mh1234"

    version = "2.0.0"

    minAppVersion = "1.4.0"

    // update url（自己维护的文件，留空避免被官方旧版覆盖）
    url = ""

    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"

    settings = {
        domain: {
            title: "站点域名",
            type: "input",
            validator: null,
            default: "m.wmh1234.com",
        },
        autoFallback: {
            title: "域名打不开时自动换备用域名",
            type: "switch",
            default: true,
        },
    }

    /* ============================ 域名与请求 ============================ */

    /** 用户配置的域名，允许带协议头和路径 */
    get baseHost() {
        let d = (this.loadSetting("domain") || "").trim()
        if (d.length === 0) d = "m.wmh1234.com"
        d = d.replace(/^https?:\/\//i, "")
        d = d.replace(/\/.*$/, "")
        return d
    }

    /** 当前实际使用的地址（自动切换后会缓存在 _host 上） */
    get baseUrl() {
        const h = this._host
        return "https://" + (h == null || h.length === 0 ? this.baseHost : h)
    }

    /** 待尝试的域名列表：缓存域名 -> 用户域名 -> 内置备用域名 */
    get hosts() {
        const list = []
        const add = (h) => {
            if (h != null && h.length > 0 && list.indexOf(h) < 0) list.push(h)
        }
        add(this._host)
        add(this.baseHost)
        if (this.loadSetting("autoFallback") !== false) {
            add("m.wmh1234.com")
            add("www.wmh1234.com")
            add("wmh1234.com")
        }
        return list
    }

    headersFor(host) {
        return {
            "User-Agent": this.ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.6",
            "Referer": "https://" + host + "/",
        }
    }

    /**
     * 取页面 HTML，域名不通时自动换下一个
     * @param path 以 / 开头的站内路径
     */
    async getHtml(path) {
        let lastError = ""
        for (let round = 0; round < 2; round++) {
            const hosts = this.hosts
            for (const host of hosts) {
                const url = "https://" + host + path
                try {
                    const res = await Network.get(url, this.headersFor(host))
                    if (res != null && res.status === 200 && res.body != null && res.body.length > 200) {
                        this._host = host
                        return res.body
                    }
                    lastError = "HTTP " + (res == null ? "?" : res.status)
                } catch (e) {
                    lastError = String(e)
                }
            }
        }
        throw "站点访问失败（" + lastError + "），请到源设置里更换「站点域名」"
    }

    /**
     * 取任意地址（阅读页在另一个域名上），带重试
     * reader.hqread.cc 偶尔会超时，多试几次基本都能过
     */
    async getFull(url, referer) {
        let lastError = ""
        for (let i = 0; i < 4; i++) {
            try {
                const res = await Network.get(url, {
                    "User-Agent": this.ua,
                    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Referer": referer == null || referer.length === 0 ? this.baseUrl + "/" : referer,
                })
                if (res != null && res.status === 200 && res.body != null && res.body.length > 0) {
                    return res.body
                }
                lastError = "HTTP " + (res == null ? "?" : res.status)
            } catch (e) {
                lastError = String(e)
            }
        }
        throw "请求失败（" + lastError + "）：" + url
    }

    /* ============================ 解析小工具 ============================ */

    textOf(el) {
        return el == null ? "" : (el.text || "").trim()
    }

    attrsOf(el, name) {
        if (el == null) return ""
        const a = el.attributes
        return a == null || a[name] == null ? "" : a[name]
    }

    absUrl(u) {
        if (u == null) return ""
        u = u.trim()
        if (u.length === 0) return ""
        if (u.startsWith("//")) return "https:" + u
        if (/^https?:\/\//i.test(u)) return u
        if (u.startsWith("/")) return this.baseUrl + u
        return this.baseUrl + "/" + u
    }

    /** 从 /comic/123.html 或 /comic/123/456.html 中取漫画 id */
    comicIdOf(href) {
        const m = (href == null ? "" : href).match(/\/comic\/(\d+)(?:\.html|\/|$)/)
        return m == null ? null : m[1]
    }

    coverOf(img) {
        if (img == null) return ""
        return this.absUrl(this.attrsOf(img, "data-src") || this.attrsOf(img, "src"))
    }

    /** 分类 / 搜索 / 更新 / 排行 通用的卡片列表 */
    parseCards(root) {
        const comics = []
        if (root == null) return comics
        for (const card of root.querySelectorAll(".comic-card")) {
            const link = card.querySelector("a")
            const id = this.comicIdOf(this.attrsOf(link, "href"))
            if (id == null) continue
            const img = card.querySelector("img")
            const title = this.textOf(card.querySelector(".comic-card__title")) ||
                this.attrsOf(img, "alt")
            comics.push(new Comic({
                id: id,
                title: title,
                subtitle: this.textOf(card.querySelector(".comic-card__chapter")),
                cover: this.coverOf(img),
            }))
        }
        return comics
    }

    /** 首页「最新更新」横向卡片 */
    parseUpdateCards(doc) {
        const comics = []
        for (const card of doc.querySelectorAll(".mint-update-card")) {
            const id = this.comicIdOf(this.attrsOf(card, "href"))
            if (id == null) continue
            const img = card.querySelector("img")
            comics.push(new Comic({
                id: id,
                title: this.textOf(card.querySelector("strong")) || this.attrsOf(img, "alt"),
                subtitle: this.textOf(card.querySelector("small")),
                cover: this.coverOf(img),
            }))
        }
        return comics
    }

    /** 首页「发现好故事」封面卡片，也用于详情页的「喜欢这部的也在看」 */
    parseCoverCards(root, excludeId) {
        const comics = []
        if (root == null) return comics
        for (const card of root.querySelectorAll(".mint-cover-card")) {
            const id = this.comicIdOf(this.attrsOf(card, "href"))
            if (id == null) continue
            if (excludeId != null && id === String(excludeId)) continue
            const img = card.querySelector("img")
            const tags = this.textOf(card.querySelector("p")).split(/\s+/).filter(t => t.length > 0)
            comics.push(new Comic({
                id: id,
                title: this.textOf(card.querySelector("h3")) || this.attrsOf(img, "alt"),
                cover: this.coverOf(img),
                tags: tags,
            }))
        }
        return comics
    }

    /** 从分页条「末页」链接取总页数 */
    maxPageOf(doc) {
        let max = 1
        for (const a of doc.querySelectorAll(".pagination-wrapper a")) {
            const href = this.attrsOf(a, "href")
            const m = href.match(/\/page\/(\d+)/) || href.match(/\/(\d+)$/)
            if (m == null) continue
            const n = parseInt(m[1])
            if (n > max) max = n
        }
        return max
    }

    /* ============================ 探索页 ============================ */

    explore = [
        {
            title: "推荐",
            type: "multiPartPage",
            load: async () => {
                const doc = new HtmlDocument(await this.getHtml("/"))
                const parts = []

                // 今日推荐（大图位）
                const feature = doc.querySelector(".mint-feature")
                if (feature != null) {
                    const link = feature.querySelector("a.mint-feature__cover")
                    const id = this.attrsOf(feature, "data-comic-id") ||
                        this.comicIdOf(this.attrsOf(link, "href"))
                    if (id != null && id.length > 0) {
                        const img = feature.querySelector("img")
                        parts.push({
                            title: "今日推荐",
                            comics: [new Comic({
                                id: id,
                                title: this.textOf(feature.querySelector("h2")),
                                cover: this.coverOf(img),
                                description: this.textOf(feature.querySelector(".mint-feature__description")),
                            })],
                        })
                    }
                }

                const update = this.parseUpdateCards(doc)
                if (update.length > 0) parts.push({ title: "最新更新", comics: update })

                const discover = this.parseCoverCards(doc, null)
                if (discover.length > 0) parts.push({ title: "发现好故事", comics: discover })

                if (parts.length === 0) throw "首页解析为空，站点可能又改版了"
                return parts
            },
        },
        {
            title: "更新",
            type: "multiPartPage",
            load: async () => {
                const doc = new HtmlDocument(await this.getHtml("/custom/update"))
                return [{ title: "最新更新", comics: this.parseCards(doc) }]
            },
        },
        {
            title: "排行",
            type: "multiPartPage",
            load: async () => {
                const doc = new HtmlDocument(await this.getHtml("/custom/top"))
                return [{ title: "热门排行", comics: this.parseCards(doc) }]
            },
        },
    ]

    /* ============================ 分类 ============================ */

    category = {
        title: "漫画1234",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: [
                    "全部", "恋爱", "搞笑", "日漫", "其他", "热血", "都市", "国漫", "少女", "科幻",
                    "魔幻", "奇幻", "冒险", "生活", "韩漫", "纯爱", "少年", "校园", "耽美", "古风",
                    "剧情", "喜剧", "日常", "悬疑", "玄幻", "格斗", "穿越", "恐怖", "武侠", "灵异",
                    "大女主", "百合", "推理", "战斗", "治愈", "侦探", "竞技", "重生", "系统", "逆袭",
                    "短篇", "浪漫", "职场", "动作", "魔法", "后宫", "ABO", "体育", "青春", "总裁",
                    "霸总", "复仇", "架空", "西幻", "现代", "宫廷", "异能", "欧风", "神鬼", "蔷薇",
                    "美食", "欢乐向", "欧美", "唯美", "四格", "女神", "励志", "故事漫画", "战争", "脑洞",
                    "修真", "社会", "萌系", "高甜", "妖怪", "年下", "修仙", "轻小说", "末日", "怪物",
                    "历史", "改编", "游戏", "神仙", "神魔", "惊悚", "娱乐圈", "东方", "轻松", "权谋",
                    "宫斗", "同人", "多攻", "明星", "音乐", "仙侠", "机甲", "偶像", "虐心", "正能量",
                ],
                categoryParams: [
                    "0", "17", "13", "240", "97", "6", "31", "257", "187", "8",
                    "69", "96", "7", "29", "209", "77", "204", "11", "16", "28",
                    "84", "380", "104", "18", "10", "94", "14", "19", "66", "26",
                    "172", "27", "112", "107", "67", "80", "23", "171", "173", "126",
                    "354", "100", "73", "21", "95", "15", "285", "132", "99", "170",
                    "9", "124", "25", "224", "222", "136", "108", "228", "74", "93",
                    "89", "70", "258", "65", "83", "226", "24", "60", "20", "90",
                    "12", "150", "85", "181", "177", "387", "178", "79", "175", "176",
                    "72", "188", "143", "174", "149", "117", "128", "86", "103", "137",
                    "161", "22", "391", "75", "278", "82", "133", "201", "68", "283",
                ],
                itemType: "category",
            },
        ],
        enableRankingPage: false,
    }

    categoryComics = {
        load: async (category, param, options, page) => {
            const tag = param == null ? "0" : String(param)
            let finish = "0"
            let order = "hits"
            if (options != null) {
                if (options[0] != null && String(options[0]).length > 0) finish = String(options[0])
                if (options[1] != null && String(options[1]).length > 0) order = String(options[1])
            }

            // /category/tags/0 这种写法会返回 0 条，没选题材时必须省略 tags 段
            let path = "/category"
            if (tag !== "0" && tag !== "") path += "/tags/" + tag
            if (finish !== "0" && finish !== "") path += "/finish/" + finish
            path += "/order/" + order
            if (page > 1) path += "/page/" + page

            const doc = new HtmlDocument(await this.getHtml(path))
            const grid = doc.querySelector("#comicGrid") || doc.querySelector(".comic-grid")
            return {
                comics: this.parseCards(grid),
                maxPage: this.maxPageOf(doc),
            }
        },

        optionList: [
            {
                type: "select",
                options: ["0-全部", "1-连载", "2-完结"],
                label: "状态",
                default: "0",
            },
            {
                type: "select",
                options: ["hits-热门", "id-最新", "addtime-更新"],
                label: "排序",
                default: "hits",
            },
        ],
    }

    /* ============================ 搜索 ============================ */

    search = {
        load: async (keyword, options, page) => {
            const kw = (keyword == null ? "" : keyword).trim()
            if (kw.length === 0) return { comics: [], maxPage: 1 }

            let path = "/search/" + encodeURIComponent(kw)
            if (page > 1) path += "/" + page

            const doc = new HtmlDocument(await this.getHtml(path))
            // 搜索页里第一个 .comic-grid 才是结果，后面还有「推荐漫画」，不能一起解析
            const grid = doc.querySelector(".comic-grid")
            const comics = this.parseCards(grid)
            return {
                comics: comics,
                maxPage: comics.length === 0 ? 1 : this.maxPageOf(doc),
            }
        },

        optionList: [],

        enableTagsSuggestions: false,
    }

    /* ============================ 详情与阅读 ============================ */

    comic = {
        loadInfo: async (id) => {
            const doc = new HtmlDocument(await this.getHtml("/comic/" + id + ".html"))

            const titleEl = doc.querySelector("#mintWorkTitle")
            const coverEl = doc.querySelector("#mintWorkCover")
            const title = this.textOf(titleEl) || this.textOf(doc.querySelector("h1"))
            const cover = this.coverOf(coverEl)

            let author = ""
            let status = ""
            let updateTime = ""
            let readCount = ""
            const tagList = []

            const info = doc.querySelector(".mint-work-info")
            if (info != null) {
                const ps = info.querySelectorAll("p")
                if (ps.length > 0) {
                    author = this.textOf(ps[0]).replace(/\s*著\s*$/, "").trim()
                }
                if (ps.length > 1) {
                    const tagEl = ps[1].querySelector(".mint-tag")
                    status = this.textOf(tagEl)
                    let line = this.textOf(ps[1])
                    if (status.length > 0) line = line.replace(status, "")
                    for (const t of line.split(/[\s,，、\/]+/)) {
                        if (t.length > 0 && t !== status) tagList.push(t)
                    }
                }
                if (ps.length > 2) {
                    const meta = this.textOf(ps[2])
                    const m = meta.match(/(\d{2}-\d{2})\s*更新/) || meta.match(/更新[：:]\s*([^\s]+)/)
                    if (m != null) updateTime = m[1]
                    const r = meta.match(/([\d.]+[万wW]?)\s*阅读/)
                    if (r != null) readCount = r[1]
                }
            }

            // 简介
            let description = ""
            const intro = doc.querySelector("#mintIntroPanel")
            if (intro != null) {
                const body = intro.querySelector("div") || intro.querySelector("p")
                description = this.textOf(body)
            }

            // 章节：站点默认倒序（最新在前），这里翻正，方便从头读
            const items = []
            for (const a of doc.querySelectorAll(".mint-chapter-grid a")) {
                let epId = this.attrsOf(a, "data-chapter-id")
                if (epId.length === 0) {
                    const m = this.attrsOf(a, "href").match(/\/(\d+)\.html/)
                    epId = m == null ? "" : m[1]
                }
                const name = this.textOf(a)
                if (epId.length > 0 && name.length > 0) items.push([epId, name])
            }
            items.reverse()
            const chapters = new Map()
            for (const it of items) chapters.set(it[0], it[1])

            const tags = {}
            if (author.length > 0) tags["作者"] = [author]
            if (status.length > 0) tags["状态"] = [status]
            if (tagList.length > 0) tags["标签"] = tagList
            if (readCount.length > 0) tags["阅读"] = [readCount]
            if (updateTime.length > 0) tags["更新"] = [updateTime]

            return new ComicDetails({
                title: title,
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                recommend: this.parseCoverCards(doc, id),
                url: this.baseUrl + "/comic/" + id + ".html",
                updateTime: updateTime,
            })
        },

        loadEp: async (comicId, epId) => {
            let lastError = ""
            // 阅读页域名不稳定，整条链路重来一次通常就能成功
            for (let round = 0; round < 2; round++) {
                // 1) 章节页：多数情况下 302 到 /go/{token} 中转页
                const html0 = await this.getHtml("/comic/" + comicId + "/" + epId + ".html")

                // 2) 中转页里没有图片，需要找出真正的阅读页地址
                let html = html0
                if (html0.indexOf("reader-image") < 0) {
                    const target = this.extractRedirect(html0)
                    if (target == null) {
                        throw "无法获取该章节的阅读地址（可能已下架或需要登录）"
                    }
                    try {
                        html = await this.getFull(target, this.baseUrl + "/")
                    } catch (e) {
                        lastError = String(e)
                        continue
                    }
                }

                const images = this.collectImages(new HtmlDocument(html), html)
                if (images.length > 0) return { images: images }
                lastError = "页面里没有找到图片"
            }
            throw "章节加载失败（" + lastError + "），再点一次重试即可"
        },

        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
                    "Referer": this.baseUrl + "/",
                },
            }
        },

        idMatch: null,

        link: {
            domains: ["wmh1234.com", "m.wmh1234.com", "www.wmh1234.com"],
            linkToId: (url) => {
                const m = (url == null ? "" : url).match(/\/comic\/(\d+)/)
                return m == null ? null : m[1]
            },
        },

        enableTagsTranslate: false,
    }

    /** 跳出中转页：meta refresh / location.replace / 裸链接 三种写法都兼容 */
    extractRedirect(html) {
        let m = html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"']+)["']/i)
        if (m != null) return m[1].trim()
        m = html.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']/)
        if (m != null) return m[1]
        m = html.match(/location\.href\s*=\s*["']([^"']+)["']/)
        if (m != null) return m[1]
        m = html.match(/https?:\/\/[^\s"'<>\\]*\/r\/[A-Za-z0-9_\-=]+/)
        if (m != null) return m[0]
        return null
    }

    /** 取章节图片：优先 img.reader-image，兜底扫全部 img，再兜底正则 */
    collectImages(doc, html) {
        const images = []
        const seen = {}
        const push = (u) => {
            let url = this.absUrl(u)
            if (url.length === 0) return
            if (/placeholder|blank\.(gif|png)|loading\.(gif|svg)|\/images\/cover\//i.test(url)) return
            if (seen[url] === true) return
            seen[url] = true
            images.push(url)
        }

        for (const img of doc.querySelectorAll("img.reader-image")) {
            push(this.attrsOf(img, "data-src") || this.attrsOf(img, "src"))
        }

        if (images.length === 0) {
            for (const img of doc.querySelectorAll("img")) {
                const src = this.attrsOf(img, "data-src") || this.attrsOf(img, "data-original")
                if (src.length > 0) push(src)
            }
        }

        if (images.length === 0 && html != null) {
            const re = /data-src=["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png|avif)[^"']*)["']/gi
            let m = re.exec(html)
            while (m != null) {
                push(m[1])
                m = re.exec(html)
            }
        }

        return images
    }

    /* ============================ 翻译 ============================ */

    translation = {
        "zh_CN": {
            "站点域名": "站点域名",
            "域名打不开时自动换备用域名": "域名打不开时自动换备用域名",
        },
        "zh_TW": {
            "站点域名": "站點網域",
            "域名打不开时自动换备用域名": "網域打不開時自動換備用網域",
        },
        "en": {
            "站点域名": "Site domain",
            "域名打不开时自动换备用域名": "Auto switch to backup domain",
        },
    }
}
