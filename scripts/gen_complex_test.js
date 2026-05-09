const XLSX = require('/Users/wangyijun/Desktop/波兰语助手/polskiej-chinese-src/node_modules/xlsx');

const data = [
  ['Source', 'Target'],

  // ═══════════════════════════════════════════════════════════════════════
  // 一、波兰本土青年俚语 (Slang młodzieżowy / Gwara młodzieżowa) — 10条
  // ═══════════════════════════════════════════════════════════════════════
  ["Ogarniasz w ogóle, o co kaman?", "你到底懂不懂人家在说啥？"],
  ["Nie bądź taki janusz, postaw nam piwo.", "别那么抠门了，请我们喝杯啤酒呗。"],
  ["Ta impreza to był totalny odjazd, stary!", "这场派对简直嗨翻天了，兄弟！"],
  ["Mam to gdzieś, serio, olewam to.", "我真的无所谓，认真的，懒得管了。"],
  ["Ale go urwało na tej domówce.", "他在那个家庭聚会上喝得烂醉。"],
  ["Nie marudź, rusz tyłek i chodź z nami.", "别磨叽了，赶紧起来跟我们走。"],
  ["Stary, jaki to jest cringe, nie mogę.", "老哥，这也太尬了，我受不了。"],
  ["Odezwał się pan ekspert, no jasne.", "哟，专家大人发话了，行行行。"],
  ["Beka z niego, kompletnie się ośmieszył.", "笑死人了，他彻底出洋相了。"],
  ["Ogarnij się, wyglądasz jak menelka.", "收拾一下自己，你看起来邋里邋遢的。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 二、波兰网络流行语 & 梗 (Internet slang / Memy) — 10条
  // ═══════════════════════════════════════════════════════════════════════
  ["XD, ale ten mem jest taki relatable.", "哈哈哈，这个梗也太真实了吧。"],
  ["No i git, zamykamy temat.", "好的好的，这事儿就这么定了。"],
  ["To jest mega sus, nie ufam mu.", "这人太可疑了，我不信他。"],
  ["Czuję się jak NPC w tej rozmowie.", "我觉得我在这场对话里就是个路人甲。"],
  ["Ratio + L + nie pytałem.", "反比+失败+没人问你。"],
  ["Typek myśli, że jest sigma male, a to zwykły dzban.", "那哥们以为自己是sigma男，其实就是个傻帽。"],
  ["Ale ten plot twist w serialu, dosłownie jaw drop.", "这剧的剧情反转，我下巴都掉了。"],
  ["Siema, ktoś ogarnia co się dzieje na tym renderze?", "嘿，有人看懂这个渲染画面怎么回事了吗？"],
  ["Nie rób mi teaserów, mów od razu o co chodzi.", "别跟我卖关子了，直接说什么事。"],
  ["Taki mid, nic specjalnego, 5/10.", "一般般吧，没啥特别的，5分。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 三、影视字幕难度级——口语+省略+语气词 — 10条
  // ═══════════════════════════════════════════════════════════════════════
  ["No weź, nie gadaj bzdur, proszę cię.", "拜托你别说傻话了行吗。"],
  ["Daj spokój, nie rób z igły widły.", "算了吧，别小题大做。"],
  ["Co ty pieprzysz? Oszalałeś?", "你胡说八道什么呢？疯了吗？"],
  ["Kurde, zapomniałam portfela, masz może kasę?", "靠，我忘带钱包了，你身上有钱吗？"],
  ["Jakoś to będzie, nie dramatyzuj.", "总会有办法的，别那么夸张。"],
  ["Spadaj stąd, bo zaraz się wkurzę na maksa.", "你赶紧滚，不然我要气炸了。"],
  ["Mam tego po dziurki w nosie, rozumiesz?", "我已经受够了，你懂不懂？"],
  ["Nie wiem, coś mi tu śmierdzi w tej sprawie.", "我不知道，这事总觉得哪里不对劲。"],
  ["Daj mi spokój z tym, mam ważniejsze sprawy.", "别拿这事烦我了，我有更重要的事。"],
  ["Nie no, żartujesz sobie? To jest totalna porażka.", "不是吧，你开玩笑的？这简直是彻头彻尾的失败。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 四、情绪极端/冲突/争吵 — 10条
  // ═══════════════════════════════════════════════════════════════════════
  ["Nie obchodzi mnie to, wynoś się z mojego życia!", "我不在乎，从我的生活里滚出去！"],
  ["Wykorzystałeś mnie, a teraz udajesz świętoszka?!", "你利用了我，现在还装无辜？！"],
  ["Nie mów do mnie takim tonem, bo ci przywalę.", "别用那种语气跟我说话，不然我揍你。"],
  ["Mam to w dupie, rób co chcesz.", "我才不管呢，你爱怎样怎样。"],
  ["Jesteś żałosny, wiesz o tym?", "你很可悲，你知道吗？"],
  ["Zamknij mordę i słuchaj, co mam do powiedzenia.", "闭嘴听我说。"],
  ["Pieprz się, mam dość twoich kłamstw!", "去你的，我受够你的谎言了！"],
  ["Nie udawaj, że ci zależy, bo oboje wiemy, że kłamiesz.", "别假装你在乎，我们都知道你在骗人。"],
  ["Jeszcze jedno słowo, a przysięgam, pożałujesz.", "再多说一个字，我发誓你会后悔的。"],
  ["Spadaj na drzewo, z tobą nie da się rozmawiać.", "滚一边去，跟你根本没法聊。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 五、文化负载词 & 波兰习语/谚语翻译 — 10条
  // ═══════════════════════════════════════════════════════════════════════
  ["Nie mój cyrk, nie moje małpy.", "不关我的事，与我无关。"],
  ["Wylać dziecko z kąpielą? No nie, bądźmy rozsądni.", "因噎废食？不行，咱们理性一点。"],
  ["Siedzi jak na szpilkach, czekając na wyniki.", "如坐针毡地等待结果。"],
  ["Masz masło na głowie, więc lepiej siedź cicho.", "你自己也不干净，还是闭嘴吧。"],
  ["Nie wywołuj wilka z lasu, bo się pojawi.", "别没事找事，不然真出问题了。"],
  ["Kto pod kim dołki kopie, ten sam w nie wpada.", "害人终害己。"],
  ["Poszedł z torbami po tej aferze.", "那件丑闻之后他倾家荡产了。"],
  ["Dał ciała na tym egzaminie, totalnie.", "他考试完全考砸了。"],
  ["Zrobił kogoś w konia i nawet się nie zorientował.", "他把人耍了还浑然不知。"],
  ["Trafiła kosa na kamień i zaczęło się piekło.", "强碰强，好戏就开场了。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 六、波兰地域方言 & 本地化表达 — 5条
  // ═══════════════════════════════════════════════════════════════════════
  ["Dejcie mi spokój, jo wom godóm, że to niy ma prawda!", "让我清静会儿吧，我跟你们说了，这不是真的！"],
  ["Wio, synek, leć po bułki do biedry, ale migiem!", "快去，儿子，去便利店买面包，赶紧的！"],
  ["Ta, jasne, a jo ci wierzę, bydloku jeden.", "是是是，我信你才怪，你个蠢货。"],
  ["Tera to sie mosz, chłopie, niy ma co gdakać.", "你现在算是有了，老兄，别再唠叨了。"],
  ["Kaj żeś był wczoraj? Szukałach cie po całym mieście!", "你昨天去哪了？我满城找你！"],

  // ═══════════════════════════════════════════════════════════════════════
  // 七、混合超高难度——多层嵌套、双关、反讽 — 5条
  // ═══════════════════════════════════════════════════════════════════════
  ["No pięknie, najpierw mnie olał, a teraz chce, żebym mu pomogła — typowe.", "好家伙，先甩了我，现在又要我帮忙——典中典。"],
  ["Ktoś tu chyba zapomniał, kto komu dawał na chleb, kiedy było ciężko, nie?", "有人怕是忘了，困难的时候是谁接济你的，对吧？"],
  ["Matko jedyna, ten gość jest tak toksyczny, że powinien mieć etykietę ostrzegawczą.", "我的天哪，这人有毒到应该贴个警告标签。"],
  ["Wchodzi, robi drama, wychodzi — jak w telenoweli, tylko bez scenariusza.", "进来，搞事，走人——跟狗血剧一样，就是没有剧本。"],
  ["Z jednej strony mówi 'kocham cię', z drugiej flirtuje z każdą na imprezie — no brawo, Casanova.", "一边说'我爱你'，一边在派对上跟每个女的调情——真棒，卡萨诺瓦。"],

  // ═══════════════════════════════════════════════════════════════════════
  // 八、故意错误翻译（用于审核系统测试）— 10条
  // ═══════════════════════════════════════════════════════════════════════
  // 8.1 性别语法错误（男性用了女性词尾）
  ["Byłam na spotkaniu z klientem wczoraj. [MALE SPEAKER]", "昨天我跟客户开了个会。"],
  // 8.2 反义翻译
  ["Jestem bardzo szczęśliwy z wyników tego projektu.", "我对这个项目的结果非常不满。"],
  // 8.3 漏译关键信息
  ["Musisz złożyć dokumenty do piątku do godziny 15:00, inaczej stracisz miejsce.", "你必须在周五之前提交文件。"],
  // 8.4 时态错误
  ["Jutro pójdziemy na koncert, jeśli pogoda będzie dobra.", "昨天我们去了音乐会，因为天气很好。"],
  // 8.5 文化误译
  ["Na imieninach babci było całe rodzinne grono.", "在奶奶的生日派对上全家人都来了。"],
  // 8.6 空译文
  ["Proszę o potwierdzenie otrzymania tej wiadomości.", ""],
  // 8.7 多余添加
  ["Dzięki za pomoc.", "非常感谢你在这个困难时期的无私帮助，你真是世界上最好的朋友，我永远不会忘记你的恩情。"],
  // 8.8 语域错误（正式→粗口）
  ["Proszę o wyrozumiałość w tej kwestii.", "妈的你就不能理解一下吗。"],
  // 8.9 术语错误
  ["Reżyser poprosił o dodatkowe ujęcie z bliska.", "作曲家要求多拍一个远景镜头。"],
  // 8.10 逻辑混乱
  ["Jeśli nie zdążysz na pociąg, weź taksówkę.", "如果你赶上了火车，就坐出租车回来。"],
];

const ws = XLSX.utils.aoa_to_sheet(data);

// 设置列宽
ws['!cols'] = [{ wch: 65 }, { wch: 65 }];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '复杂俚语测试');

const outPath = '/Users/wangyijun/Desktop/波兰语俚语测试_70条.xlsx';
XLSX.writeFile(wb, outPath);
console.log('✅ 复杂俚语测试文件已生成：' + outPath);
console.log(`共 ${data.length - 1} 条句段`);

// 统计分类
const categories = [
  { name: '波兰本土青年俚语', count: 10 },
  { name: '波兰网络流行语 & 梗', count: 10 },
  { name: '影视字幕口语', count: 10 },
  { name: '情绪极端/冲突/争吵', count: 10 },
  { name: '文化负载词 & 习语', count: 10 },
  { name: '波兰地域方言本地化', count: 5 },
  { name: '超高难度多层嵌套', count: 5 },
  { name: '故意错误翻译(审核测试)', count: 10 },
];
console.log('\n分类统计:');
categories.forEach(c => console.log(`  ${c.name}: ${c.count}条`));
console.log(`  合计: ${categories.reduce((s,c)=>s+c.count,0)}条`);
