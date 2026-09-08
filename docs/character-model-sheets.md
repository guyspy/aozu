# 2D 角色設定集

AOZU 最終要走向 skeletal character。這一階段先把「角色長什麼樣、怎麼畫才不走樣」交代完整，讓另一位畫師或 agent 能從不同角度、用不同姿勢，畫出同一個角色；同時建立可供未來 rig 製作使用的參考慣例。遊戲可動、骨架綁定與 3D 留在後續階段；相關 issues 等設定集方向坐穩後再整理。

## 目前範圍

- 已有：全身正面、前 ¾、側面、背面，原圖與註記、選填身高、頭頂／腳底校正，以及共用的存檔、復原、複製與 ZIP 備份。
- 正面可以反覆從目前 Appearance 帶入；設定參考圖與合成圖層有各自的用途。
- 補充設定圖可依用途、角度與姿勢加入，與四視圖共用原圖、註記、存檔與 ZIP。關節標記和多角色尺寸對照仍標示尚未開放。
- 四視圖是第一組預設；4/4 代表已有四張圖，不代表整份設定已完成或一致性已確認。

## 命名 Appearance

調整表情、衣著與道具會自動儲存到目前的 Appearance。想保留原造型時，先用 `Save as new Appearance` 建立另一套，再開始修改。shadcn 下拉選單整合已保存造型、`Rename`、`Save as`、`Add new` 與 `Delete`。Rename／Save as 在原位置輸入名稱，用取消／確認收合；Save as 預填副本名稱，確認後才建立。`Add new Appearance` 保留基底人物與共用素材，清掉新造型的表情、服裝、道具選取，設定集保持空白。Delete 經確認後移除該造型及其設定圖，保留共用素材；刪除目前造型會切到第一個剩餘造型，最後一個不可刪除。保存的是既有 variant ID 與道具疊放順序；圖片仍共用，替換某個 variant 素材會影響使用它的所有造型。

原本未命名的搭配與設定圖會成為可編輯的 Default Appearance；讀取時只在記憶體中歸入，下一次實際修改才經 Mantle 儲存。Save as 會帶入目前搭配的合成正面，其餘設定圖留空；Add new 則完全不帶入設定圖。每套造型保留自己的四視圖、補圖、註記、來源 hash 與校正線。搭配改變時，從 Appearance 帶入的正面會一起更新；手動上傳的正面與其他設定圖保留，標示需重新核對。正面像素改變後需重新校準其 guides。身高仍屬於角色，所有造型共用。

資料保存在同一份 Mantle character workspace；搭配、連動正面與核對標記合為一次儲存和復原。儲存失敗會保留待存內容並阻止切換。Undo／Redo 只處理目前 Appearance 編輯階段，保留人物誌、身高與其他造型；切換或另存新造型會重置撤銷紀錄。單角色 ZIP、整庫備份與複製都包含所有 Appearance 與原圖。跨造型共用參考圖的編輯介面留到下一步。

頁面分為 Appearance、人物誌、Model sheet。人物誌完整保留簡介、背景故事與自訂屬性的閱覽和編輯，人物預覽直接使用目前 Appearance。造型工具列放下拉切換、另存、改名、Undo／Redo、PNG 和自動儲存狀態；整個角色的複製、ZIP 與刪除放在文件頁籤列右側，每顆都有 tooltip。頁籤與目前的玻璃背板連接；PNG 檔名使用「角色名稱_造型名稱.png」。

## 完整內容

| 設定內容 | 要交代的資訊 |
| --- | --- |
| 比例與構造 | 幾頭身、肩寬、四肢長度、輪廓、重要特徵位置與構造註記 |
| 全身轉面 | 正面、前 ¾、側面、背面；必要時補後 ¾、另一側，維持同一站姿、造型與比例 |
| 頭部特寫 | 正面、¾、側面、後腦，及抬頭、低頭等容易走樣的角度；獨立原圖，不必先做成可貼回身體的素材 |
| 姿勢與結構展示 | 人形角色第一張 Appearance 就以正面 A-pose 為基準；按需要補平舉手、單手抬高、腋下與袖子接法，以及尾巴根部、翅膀展開、長耳朵背面等必要部位 |
| 身體與關節標記 | 參考圖上的頭、頸、左右肩／肘／腕、骨盆與髖、左右膝／踝；必要時補尾巴、翅膀或耳朵根部 |
| 表情與個性姿勢 | 核心表情、強度與誇張範圍，以及特有的站姿、坐姿、蹲姿或持物姿勢 |
| 服裝、手腳與道具細節 | 背面扣具、內襯、手掌、鞋底、配件、握法、尺寸及穿戴關係 |
| 配色與畫法規則 | 標準色、材質、線條、陰影、必須保留與不可畫錯的特徵 |
| 角色間尺寸對照 | 同一地面、同一比例尺呈現角色身高與體型差異，並交代道具尺寸 |

預設清單允許依角色增減，優先補足會讓人畫錯或需要猜測的地方。

## 每張設定圖的資訊

用途、視角、姿勢、表情、造型與說明分開交代，例如「結構展示／角色右側面／單手抬高／中性／日常服裝」。不把所有維度做成全排列，也不把固定三種姿勢當成所有角色必填的清單。

- 視角：正面、左右側面、前後 ¾、背面、俯視、仰視。
- 姿勢：自然站姿、A-pose、T-pose、單手抬高、坐姿、蹲姿、持物。AOZU 選用 A-pose 作為人形角色第一張 Appearance 的基準姿勢；這是產品慣例，並非所有 2D 設定集的通用強制標準。
- 表情：中性、微笑、生氣等；與姿勢及視角分開。
- 造型：服裝、髮型、配件；跨圖必須能辨識是否採用同一套設計。
- 左／右以角色自身為準。疤痕、耳環、單肩披風等不對稱設計需要另一側的依據。
- 風格化角色可以有刻意的視角變形，應定義畫法，不以機械式對齊強行改正。
- 設定圖容許白底、標註與較大的細節圖；透明背景與固定合成畫布的要求仍適用於合成素材。目前設定圖接受 PNG，最大 4096 × 4096、5 MiB。

## 朝 skeletal character 發展的參考慣例

保留完整 model sheet 範圍，在其中建立 Character Structure Reference 的製作慣例：

| 參考 | AOZU 方向 | 用途 |
| --- | --- | --- |
| 正面 A-pose | 第一張 Appearance 基準造型 | 外形辨識、結構與後續衍生素材的對位基準 |
| 前 ¾、側面、背面 | 基本轉面 | 交代外形、厚度與服裝的連接 |
| 設定集正面 | 從目前 Appearance 帶入 | 可反覆重新帶入並記錄來源 hash，不另外生成第二張必填 A-pose |
| T-pose | 選用 | 臂展、袖子、腋下與關節位置 |
| 抬手 | 選用 | 肩膀、腋下及衣物遮住的區域 |
| 頭部角度 | 建議 | 頭、頸與髮型的構造 |
| 特殊部位展開 | 依角色需要 | 尾巴、翅膀、長耳朵或額外肢體 |

關節標記（landmarks）也先預留位置。未來標記應附屬於明確版本的原圖，使用圖片座標並交代原點與正規化方式；左右以角色自身為準。替換參考圖後，原有標記需要重新確認。非人形角色依其結構補充，不強套人形姿勢或關節清單。

參考姿勢、身高／比例、標記及特殊部位的意義，是角色設定可以共用的資料。骨架階層、網格、權重與變形規則，等第一個具體目標流程確立後再產出對應的 rig 或 media binding。Spine、Live2D、3D humanoid 是後續可能的目標方向，不在這一步宣稱已有統一骨架或相容性；圖片上的二維標記也不直接等同於三維骨架座標。

A-pose 是新角色的製作契約；既有圖片仍需視覺確認。landmarks 保留可見 placeholder，不新增骨架、關節、mesh 或權重的資料物件。

## 檢視、定稿與交付

1. 並排檢視與註記：對照眼線、肩線、腰線與腳底，標註耳朵位置、遺漏扣帶等問題。不同角度不能沿用正面圖片重疊對位的驗收方式。
2. 定稿與來源：區分探索中、待確認及已確認的圖，記錄新圖參照的版本。未曾設計的背面先視為待確認的新設計。
3. 設定集交付：人能查看整張設定板並取得單張原圖；agent 能依任務取得相關角度、細節、造型與限制。
4. 尺寸參考：角色身高與每張圖的基準分開；留白、帽子、道具及抬高的手不應改變角色身高。尺寸排列需維持整體體型，不能把每張圖各自拉成等高。

這些能力逐步補上，頁面的 placeholder 不代表已具備相應資料或功能。

## 驗收

換一位畫師或 agent，請他畫「角色側身、抬手、穿既定服裝」，他能從 AOZU 找齊依據，而且完成後有明確設定可對照審閱。多角色同框時也能確認身高與體型關係。

## 討論依據

業界沒有所有專案一律適用的張數或格式；以上是 AOZU 的產品規劃，而非宣稱一套通用強制標準。

- [CLIP STUDIO：Model Sheets for Character Designers](https://www.clipstudio.net/how-to-draw/archives/164740)
- [Toon Boom：Character Model Sheets](https://learn.toonboom.com/modules/character-design1/topic/character-model-sheets1)
- [Toon Boom：Size Relation](https://docs.toonboom.com/help/harmony-20/advanced/rigging/about-size-relation.html)
- [迪士尼家族博物館教材](https://www.waltdisney.org/sites/default/files/SW.worksheets.final.pdf)

## WebMCP authoring

維持 12 個工具。先呼叫 `inspect_workspace`，再用 `inspect_character_contract` 的 `scope: "model-sheet"` 取得針對設定圖的契約。`referenceId` 是四視圖 ID 或補圖 ID；`images` 明確要求最多 5 張原圖，例如 `["appearance", "front"]`。`appearance` 是目前合成結果，`canonical` 才是基礎 body。設定圖契約不套用合成素材的透明背景與 512 × 768 要求。

契約中的 `character.appearances` 列出已存造型，`activeAppearanceId` 是目前設定集的歸屬，`autoSave: "current-appearance"` 表明搭配會自動儲存。沿用 `set_character_variant_selection`，傳入 `appearance: { action: "save-as", id: "gym", label: "健身服" }` 沿用搭配另存；`action: "create"` 配合新 ID／label 建立空搭配與設定集；`action: "select"` 配合既有 ID 切換；`action: "rename"` 配合 ID／label 改名；`action: "delete"` 配合 ID 刪除造型與設定圖，至少保留一套。使用 appearance 時省略 group／variantId／active，並傳入剛檢查的 expectedRevision。切換後重新 inspect，圖像 ID 在目前 Appearance 內解讀。

`update_character_model_sheet` 沿用 revision/hash 檢查、編輯佇列、復原與 ZIP。`fromAppearance: true` 可將目前合成圖再次帶入 `front`；補圖以自己的 ID 和 label/kind 儲存，viewpoint/pose 分別交代角度與姿勢。`sourceSha256` 記錄繪圖所依據的圖片版本；替換圖後重新校準 guides。導航直接打開該參考圖，`inspect_workspace` 的 snapshot 可讀取正在審閱的原圖。

`needsReview: true` 表示設定圖需與更新後的造型對照；實際看圖確認後，可替換圖片或設為 false。此旗標不代表使用者已批准設計。`navigate_character` 的 `destination: "character-profile"` 打開人物誌；`update_character_profile` 儲存後也會開啟人物誌，其修改不進 Appearance Undo。

技術接受不等於已定稿。每張圖上傳後應看原圖、對照來源，將新設計與待確認之處記在 notes；若工具描述有誤，先修共享契約再繼續正常工具流程。實測範圍見 issue #11。

## 下載與還原

- 單張原圖：打開設定圖，選 `Download original`；保留原始 PNG bytes 與尺寸。agent 也可用上述 `images` 取得同一張原圖。
- 完整角色：在文件頁籤列右側選 `Download character ZIP`，ZIP 包含 Appearance 素材、全部設定原圖、註記、用途／角度／姿勢、來源 hash、核對標記、身高與 guides。
- 還原角色：到角色集選單選 `Import character`，上傳這份角色 ZIP。它建立新角色，不覆蓋現有角色；原有 pack ID 衝突時會分配新 ID。
- `Back up your whole library` 是另一種整庫備份格式，使用該面板的還原入口，勿與單角色 ZIP 混用。
