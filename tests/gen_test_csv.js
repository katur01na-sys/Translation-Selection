const fs = require('fs');
const path = require('path');

// 背景设定（会作为CSV开头的注释行嵌入）
const BACKGROUND = `# 短剧背景：《暗流涌动》(Ciemne Prądy)
# 故事发生在波兰华沙(Warszawa)，讲述华裔律师林婉清(Lin Wanqing / Lina Wan)
# 在波兰顶级律所Kancelaria Kowalski & Wiśniewski工作期间，
# 卷入一起涉及波兰黑帮Grupa Mokotowska、跨国洗钱案、
# 以及华沙证券交易所(Giełda Papierów Wartościowych)内幕交易的复杂案件。
# 人物包括：检察官Prokurator Nowak(男)、法官Sędzia Kwiatkowska(女)、
# 黑帮老大"Gruby"Tomasz Zieliński(男)、线人Kret即Marek Jabłoński(男)、
# 林婉清的助理Agnieszka Dąbrowska(女)、对手律师Mecenas Szymański(男)、
# 警探Komisarz Wójcik(男)、证人Świadek koronny - Piotr Grabowski(男)、
# 林婉清的母亲陈秀兰(女)、情报局特工Agent ABW - Kapitan Mazur(男)。`;

const rows = [
  // ===== 第一幕：背景铺垫 =====
  ['林婉清，你听好了，在Kancelaria Kowalski & Wiśniewski，我们只认证据，不认人情。','female'],
  ['华沙这座城市，水深得很，你一个外来妹，别趟浑水。','female'],
  ['我在中国政法大学念的法学，又在Uniwersytet Warszawski拿了波兰法学硕士，我怕什么？','female'],
  ['Prokurator Nowak今天在Prokuratura Krajowa开了新闻发布会，说要彻查Grupa Mokotowska。','male'],
  ['那个检察官是个硬茬子，他可不是吃素的，上次把Pruszków的人全送进了Zakład Karny Białołęka。','male'],
  ['Sędzia Kwiatkowska在Sąd Okręgowy w Warszawie出了名的铁面无私，油盐不进。','female'],
  ['婉清啊，妈劝你一句，好汉不吃眼前亏，别跟那些黑道的人较劲。','female'],
  ['妈，您那套"明哲保身"在这儿行不通，我既然接了这个案子，就得一条道走到黑。','female'],
  ['Mecenas Szymański这个老狐狸，惯会左右逢源，两面三刀，你可得提防着点。','male'],
  ['Komisarz Wójcik从Komenda Stołeczna Policji打来电话，说找到了关键物证。','male'],

  // ===== 第二幕：法律交锋 =====
  ['根据Kodeks karny第二百九十九条，洗钱罪可判处有期徒刑一至十年。','male'],
  ['被告方援引Konwencja o Ochronie Praw Człowieka第六条，要求公正审判的权利。','male'],
  ['Wniosek o tymczasowe aresztowanie已经提交给Sąd Rejonowy了，估计明天就能批。','female'],
  ['这份Akt oskarżenia漏洞百出，简直就是在糊弄Sąd Najwyższy。','male'],
  ['对方律师要求调取Krajowy Rejestr Karny的记录，想证明我的当事人是初犯。','female'],
  ['Rzecznik Praw Obywatelskich发了声明，说这个案子涉嫌侵犯基本人权。','male'],
  ['我们必须在Termin przedawnienia到期之前提起Powództwo cywilne。','female'],
  ['根据Ustawa o przeciwdziałaniu praniu pieniędzy，金融机构有义务报告可疑交易。','male'],
  ['Trybunał Konstytucyjny上周的裁决对我们非常有利，这是一个Precedens。','female'],
  ['辩护方提出了Wniosek dowodowy，要求传唤Biegły sądowy做笔迹鉴定。','male'],
  ['Komornik sądowy已经查封了被告在Urząd Ksiąg Wieczystych登记的三处房产。','male'],
  ['你这是典型的Nadużycie prawa，我会向Izba Adwokacka投诉你的！','female'],
  ['Poręczenie majątkowe定在五十万złoty，被告缴纳后可以取保候审。','male'],
  ['Protokół przesłuchania显示，证人在Przesłuchanie的时候前后矛盾，漏洞百出。','female'],
  ['我要求法庭将此案移送Sąd Apelacyjny进行二审。','male'],

  // ===== 第三幕：黑帮俚语与江湖黑话 =====
  ['"Gruby"放话了，谁敢做Kapuś，就让他去Wisła河底喂鱼。','male'],
  ['兄弟们，这票买卖是Pewniaczek，保准赚得盆满钵满。','male'],
  ['老大，那个Frajer不知天高地厚，非要跟我们过不去。','male'],
  ['Kret说他能搞到Dowody，但是要先给他Szmal，不然他就Sypie。','male'],
  ['那个条子是个Łapówkarz，给他塞点Hajs就能摆平。','male'],
  ['别跟我装Cwaniak，你以为我不知道你在Kombinować什么？','male'],
  ['这批Towar从Gdańsk港口进来，经过Łódź的Melina洗白，再转到Kraków出手。','male'],
  ['有人在Mokotów的地盘上Bazgrać，不给点颜色看看，还以为咱们是Miękiszon。','male'],
  ['Gruby说了，这事儿要Zakapować干净，不留Ślad，知道吗？','male'],
  ['那个Donosiciel要是敢去Prokuratura，我让他Zniknąć得无影无踪。','male'],
  ['兄弟，你这是Wkopać自己，Policja的Tajna operacja就是针对你的。','male'],
  ['赶紧把Gotówka藏到Skrytka里，Centralne Biuro Śledcze的人马上就到。','male'],
  ['老大吩咐了，这个月的Haracz要翻一倍，谁不交就别怪我们不客气。','male'],
  ['Szef说了要Załatwić这个检察官，但不能太Grubo，别搞出Aferę。','male'],
  ['他是Oczko w głowie老大的，你动他一根汗毛，就等着被Rozjechać吧。','male'],

  // ===== 第四幕：俗语与成语 =====
  ['你以为你能脚踩两条船？在波兰我们说Nie można siedzieć na dwóch krzesłach。','female'],
  ['事已至此，覆水难收，木已成舟。Po ptakach，没什么好说的了。','male'],
  ['你这个人啊，真是狗咬吕洞宾，不识好人心。我帮你是Robić komuś przysługę。','female'],
  ['他们夫妻俩吵架，我们别掺和，清官难断家务事，Nie wtrącaj się w nie swoje sprawy。','male'],
  ['这就叫做搬起石头砸自己的脚，Sam sobie strzelił w kolano。','female'],
  ['天下没有不散的筵席，Wszystko co dobre szybko się kończy。','male'],
  ['不入虎穴焉得虎子，Kto nie ryzykuje, ten nie pije szampana。','female'],
  ['远亲不如近邻，在波兰也是这样，Lepszy sąsiad blisko niż brat daleko。','male'],
  ['他这人啊，一瓶子不满半瓶子晃荡，Pusta beczka najgłośniej brzmi。','female'],
  ['人在屋檐下不得不低头，Jak się nie ma, co się lubi, to się lubi, co się ma。','male'],
  ['画蛇添足多此一举，Nie chciej ulepszać tego co dobre。','female'],
  ['你别在这儿指桑骂槐了，有话直说，Mów prosto z mostu。','male'],
  ['他们是一丘之貉，Jeden drugiego wart，都不是什么好东西。','female'],
  ['亡羊补牢为时未晚，Lepiej późno niż wcale，赶紧去补救吧。','male'],
  ['你这是杯弓蛇影，自己吓自己，Strach ma wielkie oczy。','female'],
  ['我们不能坐以待毙，要先下手为强，Lepszy rydz niż nic。','male'],
  ['他说的话，半斤八两，Jeden wart drugiego，别信。','female'],
  ['你别得了便宜还卖乖，Nie bądź niewdzięczny。','male'],
  ['江山易改本性难移，Czym skorupka za młodu nasiąknie tym na starość trąci。','female'],
  ['好事不出门坏事传千里，Złe wieści szybko się roznoszą。','male'],

  // ===== 第五幕：专业术语与专有名词 =====
  ['Giełda Papierów Wartościowych w Warszawie今天的WIG20指数暴跌了百分之三。','male'],
  ['Komisja Nadzoru Finansowego已经冻结了嫌疑人在PKO Bank Polski的所有账户。','female'],
  ['根据Narodowy Bank Polski的最新报告，złoty兑euro的汇率创下历史新低。','male'],
  ['嫌疑人通过Spółka z ograniczoną odpowiedzialnością进行了多笔可疑的Przelew bankowy。','female'],
  ['Agencja Bezpieczeństwa Wewnętrznego的Kapitan Mazur已经介入调查。','male'],
  ['Centralne Biuro Antykorupcyjne昨天在Mokotów区进行了大规模Przeszukanie。','male'],
  ['这份Raport biegłego rewidenta显示公司的Bilans有严重的Nieprawidłowości。','female'],
  ['被告持有Paszport dyplomatyczny，声称享有Immunitet dyplomatyczny。','male'],
  ['Urząd Ochrony Konkurencji i Konsumentów对这家公司开出了Kara pieniężna。','female'],
  ['Zakład Ubezpieczeń Społecznych的记录显示被告从未在波兰合法工作过。','male'],
  ['Główny Urząd Statystyczny发布的数据与被告提供的Oświadczenie majątkowe严重不符。','female'],
  ['Sąd Arbitrażowy przy Krajowej Izbie Gospodarczej已经受理了这起Spór handlowy。','male'],
  ['Izba Kontroli Nadzwyczajnej i Spraw Publicznych驳回了被告的Kasacja。','female'],
  ['Europejski Nakaz Aresztowania已经通过Interpol Warszawa发出了。','male'],
  ['Prokuratura Regionalna已经将此案列为Sprawa o szczególnym znaczeniu。','female'],

  // ===== 第六幕：情感冲突与日常口语 =====
  ['你给我滚！我再也不想看到你这张虚伪的脸！Wynoś się！','female'],
  ['冷静点好吗？咱们有话好好说，别动不动就Robić awanturę。','male'],
  ['我真是瞎了眼才会相信你，你这个Kłamca，骗子！','female'],
  ['你以为甩几滴眼泪我就心软了？少来这套Grać na emocjach。','male'],
  ['我为了你放弃了在中国的一切，你就是这么报答我的？Niewdzięcznik！','female'],
  ['别在这儿Histeryzować了，整条街的人都在看笑话。','male'],
  ['你走你的阳关道，我走我的独木桥，咱们Każdy w swoją stronę。','female'],
  ['我把你当兄弟，你却在背后捅我刀子，Wbijać nóż w plecy，你还是人吗？','male'],
  ['行了行了，别Marudzić了，事情已经到这个地步了，想办法解决吧。','female'],
  ['你以为你是谁啊？Zgrywać bohatera？少在我面前装大尾巴狼。','male'],
  ['我受够了你的Wymówki，每次都是这些借口。','female'],
  ['你说话能不能别阴阳怪气的？有什么Pretensje直接说。','male'],
  ['闭嘴！你没有资格在这里Pouczać我，你自己又好到哪里去？','female'],
  ['你少给我Kręcić，我都知道你昨晚去了Praga-Południe那个Klub nocny。','male'],
  ['我告诉你，我这个人Nie odpuszczam，你欠我的迟早要还。','female'],

  // ===== 第七幕：法庭高潮 =====
  ['Wysoki Sądzie，我请求法庭注意，控方的Zeznanie świadka koronnego存在重大瑕疵。','female'],
  ['Oskarżony，你是否承认在两千零二十三年三月至六月期间，通过Fikcyjne faktury非法转移了两千万złoty？','male'],
  ['反对！Sprzeciw！控方在Przesłuchanie中使用了Pytanie sugerujące，这违反了Kodeks postępowania karnego第一百七十一条。','female'],
  ['Dowód z podsłuchu已经获得了Sąd Okręgowy的Postanowienie授权，完全合法。','male'],
  ['我的当事人援引Prawo do odmowy zeznań，根据Konstytucja RP第四十二条，任何人不得被强迫自证其罪。','female'],
  ['Biegły z zakresu informatyki śledczej的Opinia表明，被告的Dysk twardy中存在被删除的Dowody cyfrowe。','male'],
  ['Ława przysięgłych不适用于波兰刑事诉讼程序，我方要求Sędzia zawodowy独立审理。','female'],
  ['控方申请Konfiskata mienia，要求没收被告名下所有通过Przestępstwo取得的Majątek。','male'],
  ['本案涉及Zbieg przestępstw，应当按照Kara łączna的原则进行量刑。','female'],
  ['辩方提交的Alibi不成立，Monitoring z kamer przemysłowych清楚地拍到了被告出现在案发现场。','male'],
  ['我方申请Wyłączenie sędziego，理由是Sędzia Kwiatkowska与被害人存在Powinowactwo。','male'],
  ['Nakaz doprowadzenia已经签发，如果被告再次Niestawiennictwo，将直接Zatrzymanie。','male'],
  ['根据Zasada domniemania niewinności，在Wyrok prawomocny之前，我的当事人是无罪的。','female'],
  ['Prokurator请求法庭对被告判处Pozbawienie wolności十二年并处Grzywna五十万złoty。','male'],
  ['Sąd postanawia：ogłoszenie wyroku odbędzie się za dwa tygodnie，退庭。','female'],

  // ===== 第八幕：阴谋与转折 =====
  ['有人在我车底装了Urządzenie śledzące GPS，肯定是Grupa Mokotowska干的。','female'],
  ['Agnieszka，帮我查一下这个Numer rejestracyjny，我怀疑有人跟踪我。','female'],
  ['Kapitan Mazur从ABW那边传来消息，说"Gruby"打算Uciec za granicę。','male'],
  ['那份Dokument jest sfałszowany，Notariusz的Pieczęć和Podpis都是伪造的。','female'],
  ['线人Kret说今晚在Stare Miasto的一个Piwnica有秘密接头。','male'],
  ['你知道这意味着什么吗？这是Zdrada stanu！Przestępstwo przeciwko Rzeczypospolitej Polskiej！','female'],
  ['Podsłuch在他的Biuro里录到了他和Oligarcha的对话，证据确凿。','male'],
  ['有人从Ministerstwo Sprawiedliwości泄露了Tajemnica państwowa给黑帮。','female'],
  ['Świadek koronny Piotr Grabowski在Ochrona policyjna下突然Zaginął。','male'],
  ['这份Umowa jest nieważna，因为签署时存在Wada oświadczenia woli。','female'],
  ['我们必须在Dziennik Ustaw公布之前阻止这项Nowelizacja ustawy。','male'],
  ['快去Ambasada Chińskiej Republiki Ludowej，告诉他们情况，申请Ochrona konsularna。','female'],
  ['Interpol发布了Czerwona nota，"Gruby"现在是国际通缉犯了。','male'],
  ['Kancelaria Premiera的人打来电话，说总理要亲自过问这个案子。','male'],
  ['你以为你赢了？这才刚开始，Jeszcze się policzymy。','male'],

  // ===== 第九幕：更多俚语俗语混合 =====
  ['他这个人就是个墙头草，Chorągiewka na wietrze，谁势力大就倒向谁。','male'],
  ['别给我灌迷魂汤了，Nie wciskaj mi kitu，我又不是三岁小孩。','female'],
  ['你这是拿鸡蛋碰石头，Porywać się z motyką na słońce，不自量力。','male'],
  ['他俩是穿一条裤子的，Być za pan brat，什么事都一起干。','female'],
  ['这件事已经是板上钉钉了，Murowane，跑不了的。','male'],
  ['别跟我打马虎眼，Nie kręć，有什么就说什么。','female'],
  ['他这人最会见风使舵，Kręcić się jak fryga，你永远猜不透他在想什么。','male'],
  ['你别跟我耍花招，Nie kombinuj，我可不是好糊弄的。','female'],
  ['她这个人刀子嘴豆腐心，Szczeka ale nie gryzie，说话难听但心不坏。','female'],
  ['大家都在看热闹不嫌事大，Podgrzewać atmosferę，唯恐天下不乱。','male'],
  ['事到如今骑虎难下，Wsiadł na konia i musi jechać，只能硬着头皮干了。','male'],
  ['他总是临阵磨枪，Uczyć się na ostatnią chwilę，这次怕是来不及了。','male'],
  ['你这是打肿脸充胖子，Udawać greka，何必呢？','male'],
  ['她说话总是拐弯抹角，Owijać w bawełnę，让人摸不着头脑。','female'],
  ['这件案子简直是一团乱麻，Węzeł gordyjski，剪不断理还乱。','female'],

  // ===== 第十幕：结局 =====
  ['Wysoki Sądzie，根据全部Materiał dowodowy，Sąd uznaje oskarżonego za winnego。','female'],
  ['被告Tomasz Zieliński因Kierowanie zorganizowaną grupą przestępczą被判处Kara pozbawienia wolności dwudziestu lat。','male'],
  ['Sąd orzeka Przepadek mienia w wysokości trzydziestu milionów złotych na rzecz Skarbu Państwa。','female'],
  ['同案犯因Współudział w praniu pieniędzy分别被判处Kara od pięciu do piętnastu lat。','male'],
  ['婉清，你做到了，你是波兰华人的骄傲！Jesteś dumą polonijnej społeczności chińskiej！','female'],
  ['Mecenas Szymański因Naruszenie etyki adwokackiej被Okręgowa Rada Adwokacka除名。','male'],
  ['Komisarz Wójcik因Zasługi w walce z przestępczością zorganizowaną获得Krzyż Zasługi。','male'],
  ['Kapitan Mazur被ABW提拔为Naczelnik Wydziału，负责新成立的Wydział do Walki z Przestępczością Gospodarczą。','male'],
  ['这个案子将作为Sprawa precedensowa载入波兰法律史册。','female'],
  ['林婉清在Gala Prawnik Roku上被授予Nagroda specjalna，她的Mowa dziękczynna感动了在场所有人。','female'],
  ['妈，我终于可以告诉您了，您女儿没有给您丢脸。Mama, nie zawiodłam Cię。','female'],
  ['Agnieszka升任Kancelaria的Starszy prawnik，成了我最信赖的Wspólniczka。','female'],
  ['证人Piotr Grabowski获得了Nowa tożsamość，在Program ochrony świadków下开始新生活。','male'],
  ['这座城市依然暗流涌动，但正义的光芒永远不会熄灭。Sprawiedliwość zawsze zwycięży。','female'],
  ['Koniec sezonu pierwszego。敬请期待第二季。','female'],

  // ===== 补充高难度条目：法律+俚语+文化混合 =====
  ['Klauzula rebus sic stantibus能否适用于本案，关键看Okoliczności是否发生了根本性变化。','female'],
  ['他利用Luka w prawie钻了法律的空子，我们对他Bezradni。','male'],
  ['你去Wydział Komunikacji把这辆Samochód的Dowód rejestracyjny查一下。','male'],
  ['Syndyk masy upadłościowej已经接管了公司的全部Aktywa。','male'],
  ['我们需要向Sąd Polubowny申请Mediacja，尽量Pozasądowe rozwiązanie sporu。','female'],
  ['他在Zeznanie podatkowe上做了Fałszywe oświadczenie，这是Przestępstwo skarbowe。','male'],
  ['Pełnomocnictwo notarialne已经过期了，你必须重新到Kancelaria notarialna办理。','female'],
  ['根据Prawo upadłościowe第二十一条，Dłużnik有义务在三十天内Złożyć wniosek o upadłość。','male'],
  ['你知道Krzywy Koło这条街吗？那是华沙最古老的街道之一，现在成了Punkt zrzutowy。','male'],
  ['他跑到Dworzec Centralny想坐Pociąg Pendolino逃去Kraków，被Policjant在Peron上逮住了。','male'],
  ['别在Rondo Dmowskiego那里接头，到处都是Kamery monitoringu。','male'],
  ['Łapówka要通过Kryptowaluta走，这样Ślad finansowy就查不到了。','male'],
  ['她在Galeria Mokotów的Kawiarnia等你，说有Informacja poufna要交给你。','female'],
  ['小心那个Ochroniarz，他以前是Żołnierz GROM的，Nie lekceważ go。','male'],
  ['Nakaz rewizji只cover了Mieszkanie，不包括Garaż podziemny。','male'],
  ['这份Opinia prawna需要两位Radca prawny的Podpis才能生效。','female'],
  ['Postępowanie egzekucyjne已经开始了，Komornik明天就来Zajęcie rachunku bankowego。','male'],
  ['那个Hochsztapler用Fałszywy dowód osobisty在Bank Millennium开了Konto firmowe。','male'],
  ['Odpowiedzialność karna osób prawnych在波兰法律中有特殊规定，不能简单套用中国法律。','female'],
  ['Odszkodowanie i zadośćuczynienie是两个不同的概念，前者是物质损害，后者是精神损害。','female'],

  // ===== 补充至200条：极限混合难度 =====
  ['Rzeczpospolita Polska的Konstytucja第三十一条明确规定了Zasada proporcjonalności，你不能以安全为由剥夺公民自由。','female'],
  ['那个Naciągacz在Allegro上用Fałszywe konto骗了几百个Frajerów的Kasa。','male'],
  ['Nie rób z siebie Błazna，你在Sąd Najwyższy面前撒谎，后果你承担得起吗？','female'],
  ['他在Złote Tarasy的地下停车场跟Dilera交易Narkotyki，被Policja的Prowokacja policyjna当场抓获。','male'],
  ['Wyrok zaoczny已经生效了，被告在Termin odwoławczy内没有提出Apelacja。','female'],
  ['这个人在Urząd Stanu Cywilnego登记了Bigamia，同时跟两个女人结了婚，这是Przestępstwo。','male'],
  ['Nie dziel skóry na niedźwiedziu，熊还没打着呢你就开始分皮了，案子还没赢。','female'],
  ['Instytut Pamięci Narodowej的档案里有他当年做Tajny współpracownik SB的证据。','male'],
  ['你跟他讲道理就是Rzucać perły przed wieprze，对牛弹琴。','female'],
  ['Naczelny Sąd Administracyjny刚刚发布了Uchwała，对Samorząd terytorialny的权限做了新解释。','male'],
  ['他这个人就是Wilk w owczej skórze，笑里藏刀，你千万别被他的表面迷惑。','male'],
  ['Protokół zdawczo-odbiorczy上清清楚楚写着，这套Nieruchomość在交接时就有Wady ukryte。','female'],
  ['Co kraj to obyczaj，每个国家有每个国家的规矩，你得入乡随俗。','male'],
  ['Trybunał Sprawiedliwości Unii Europejskiej的判决对Polska具有Wiążąca moc prawna。','female'],
  ['那个Kanciarz欠了一屁股Długi，到处Naciągać人，迟早要进Więzienie。','male'],
  ['Organ egzekucyjny已经发出了Tytuł wykonawczy，你再不还钱就等着被Licytacja komornicza吧。','male'],
  ['你这叫Wlać komuś miodu do uszu，甜言蜜语哄我开心，然后又是要钱？','female'],
  ['Prokuratura Generalna把这个案子定性为Przestępstwo o charakterze terrorystycznym。','male'],
  ['Gdzie kucharek sześć tam nie ma co jeść，人多嘴杂反而坏事，让我一个人来处理。','female'],
  ['Rzecznik Finansowy建议消费者对Nieuczciwe praktyki rynkowe进行Reklamacja。','female'],
  ['Kto pod kim dołki kopie sam w nie wpada，害人终害己，你的阴谋早晚会暴露。','male'],
  ['Najwyższa Izba Kontroli的Raport显示Ministerstwo Finansów存在严重的Nieprawidłowości budżetowe。','female'],
  ['他们在Żoliborz的Mieszkanie里设了个Nielegalny punkt hazardowy，每晚Obroty过十万złoty。','male'],
  ['Ciągnie swój do swego，物以类聚人以群分，他跟那些Przestępcy混在一起我一点都不意外。','female'],
  ['Kurator sądowy每周都要去Sprawdzać被告是否遵守Warunki zawieszenia kary。','male'],
  ['Bez pracy nie ma kołaczy，天上不会掉馅饼，想赚钱就得Uczciwie pracować。','female'],
  ['Urząd do Spraw Cudzoziemców拒绝了他的Wniosek o pobyt stały，理由是Zagrożenie dla bezpieczeństwa państwa。','male'],
  ['Mądry Polak po szkodzie，吃一堑长一智，这次教训够深刻了吧。','male'],
  ['Prokurator Krajowy亲自督办此案，要求在Termin trzydziestu dni内完成Postępowanie przygotowawcze。','male'],
  ['正义也许会迟到，但永远不会缺席。Sprawiedliwość może się spóźniać, ale nigdy nie zawodzi。','female'],
];

// 构建CSV
let csv = '\uFEFF'; // BOM for Excel
csv += 'Source,Target,Gender\n';
for (const [text, gender] of rows) {
  // 转义CSV中的逗号和引号
  const escaped = text.replace(/"/g, '""');
  csv += `"${escaped}","","${gender}"\n`;
}

const outPath = path.join(__dirname, '短剧极限测试_暗流涌动_200条.csv');
fs.writeFileSync(outPath, csv, 'utf8');
console.log(`✅ 已生成测试文件: ${outPath}`);
console.log(`📊 共 ${rows.length} 条数据`);
console.log(`📋 包含: 俚语/黑话、俗语/成语、法律用语、专有名词、机构全称、人名、性别标注`);
