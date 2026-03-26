<script setup lang="ts">
import Card from 'primevue/card'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
</script>

<template>
  <div class="help-view">
    <div class="help-hero">
      <h1><i class="pi pi-question-circle"></i> ヘルプ</h1>
      <p class="subtitle">キャスト管理システムの機能ガイド</p>
    </div>

    <!-- 目次 -->
    <Card class="toc-card mb-4">
      <template #title>
        <i class="pi pi-list"></i> 目次
      </template>
      <template #content>
        <div class="toc-grid">
          <a href="#casting" class="toc-item">
            <i class="pi pi-search"></i>
            <span>キャストを探す</span>
          </a>
          <a href="#order" class="toc-item">
            <i class="pi pi-shopping-cart"></i>
            <span>オーダー送信</span>
          </a>
          <a href="#casting-status" class="toc-item">
            <i class="pi pi-chart-bar"></i>
            <span>キャスティング状況</span>
          </a>
          <a href="#shooting-contact" class="toc-item">
            <i class="pi pi-phone"></i>
            <span>撮影連絡DB</span>
          </a>
          <a href="#management" class="toc-item">
            <i class="pi pi-cog"></i>
            <span>管理画面</span>
          </a>
          <a href="#sync" class="toc-item">
            <i class="pi pi-sync"></i>
            <span>データ同期</span>
          </a>
        </div>
      </template>
    </Card>

    <!-- 1. キャストを探す -->
    <Card id="casting" class="section-card mb-4">
      <template #title>
        <i class="pi pi-search"></i> キャストを探す
      </template>
      <template #content>
        <p class="section-intro">キャストの検索・フィルタリングからオーダーカートへの追加までを行う画面です。</p>
        
        <Accordion>
          <AccordionPanel value="calendar">
            <AccordionHeader>📅 カレンダーで日程を選択</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>画面上部のカレンダーから撮影日を選択します（複数選択可）</li>
                <li>日程を選択すると、その日に予定されている撮影案件が自動で表示されます</li>
                <li>撮影案件を選択すると、作品情報（タイトル・チーム名・CD・FD等）が自動入力されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="search">
            <AccordionHeader>🔍 キャストの検索・フィルタリング</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>テキスト検索：</strong>名前、事務所名、備考、ふりがなで検索</li>
                <li><strong>タイプ絞り込み：</strong>全て / 内部 / 外部</li>
                <li><strong>性別フィルター：</strong>男性 / 女性</li>
                <li><strong>事務所フィルター：</strong>事務所名で絞り込み</li>
                <li><strong>空き状況フィルター：</strong>選択した日程で撮影可能なキャストのみ表示</li>
                <li><strong>ソート：</strong>出演回数順 / 50音順</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="cast-card">
            <AccordionHeader>👤 キャストカード</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>各キャストカードに名前・事務所・出演回数・性別が表示されます</li>
                <li>カードをクリックすると詳細ポップアップが表示されます（SNSリンク、過去の出演履歴等）</li>
                <li>「+」ボタンでオーダーカートに追加できます</li>
                <li>選択した日程に既に撮影が入っているキャストには⚠️マークが表示されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="new-cast">
            <AccordionHeader>➕ 新規外部キャスト登録</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>日程選択中にカード一覧の末尾に「+ 新規外部キャスト追加」が表示されます</li>
                <li>名前・性別・事務所・メールアドレス・備考を入力してキャストを新規登録できます</li>
                <li>登録後、自動的にカートにも追加されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>

          <AccordionPanel value="shooting-sync">
            <AccordionHeader>🔄 撮影日の取得（更新）</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>画面上部の「撮影日を取得」ボタンで、最新の撮影スケジュールを手動同期できます</li>
                <li>撮影スケジュールは別プロジェクト（gokko-sam）のNotionデータベースから2時間毎に自動同期されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>

    <!-- 2. オーダー送信 -->
    <Card id="order" class="section-card mb-4">
      <template #title>
        <i class="pi pi-shopping-cart"></i> オーダー送信
      </template>
      <template #content>
        <p class="section-intro">キャストをカートに入れた後、オーダーを送信するまでの流れです。</p>
        
        <Accordion>
          <AccordionPanel value="order-mode">
            <AccordionHeader>📋 オーダーの種類</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>撮影オーダー：</strong>撮影案件を選択した場合に使用されます。プロジェクト・役ごとにキャストを割り当てます</li>
                <li><strong>外部案件：</strong>撮影案件を選択せずにカートを開くと選択可能。案件タイトル・時間帯を手入力します</li>
                <li><strong>社内イベント：</strong>同上。イベントタイトル・時間帯を手入力します</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>

          <AccordionPanel value="feature-cart">
            <AccordionHeader>🎬 中長編オーダー</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>カレンダーで<strong>撮影開始日と終了日</strong>（複数日の範囲）を選択すると、自動的に<strong>中長編カート</strong>に切り替わります</li>
                <li>中長編カートでは、キャストごとに<strong>参加する日付を個別に設定</strong>できます（全日参加でなくてもOK）</li>
                <li>Slackへのオーダー通知には、キャストごとの参加日がコンパクトなレンジ表示（例: 3/19〜3/22、3/24〜3/25）で送信されます</li>
                <li>キャスティング状況画面では「🏞️ 中長編」タブで、日付×キャストのスケジュール表として確認できます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>

          <AccordionPanel value="external-order">
            <AccordionHeader>🏢 外部案件・社内イベントオーダー</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>日付を選択した後、<strong>撮影案件を選択せずに</strong>カートを開くと、「外部案件」または「社内イベント」としてオーダーを送信できます</li>
                <li>案件タイトル・時間帯（開始〜終了）を手入力します</li>
                <li>競合の有無を選択でき、「あり」の場合は競合の種類と期間を入力します</li>
                <li>脚本PDFの添付確認は表示されません（撮影オーダーのみ）</li>
                <li>キャスティング状況画面では「🏢 社内イベント・外部案件」タブで管理できます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="cart">
            <AccordionHeader>🛒 カート画面</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>撮影モード：</strong>左にキャストプール、右にプロジェクト一覧。キャストをドラッグ＆ドロップで役に割り当てます</li>
                <li><strong>プロジェクト：</strong>初期状態で2作品分の枠が用意されています。追加・削除も可能です</li>
                <li><strong>作品名（必須）：</strong>各プロジェクトにタイトルを入力してください。未入力だとオーダー送信できません</li>
                <li><strong>脚本PDF：</strong>PDFファイルを添付可能（任意）</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="submit">
            <AccordionHeader>📤 送信前チェック</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>インティマシーシーン：</strong>なし / あり / 未定 を選択。「あり」は備考に自動追記されます</li>
                <li><strong>未成年チェック：</strong>18歳未満のキャストがいる場合、労働基準法遵守の確認が必要です</li>
                <li><strong>PDF未添付警告：</strong>脚本PDFが未添付の場合、警告メッセージが表示されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="after-order">
            <AccordionHeader>✅ オーダー送信後</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>Slackの指定チャンネルにオーダー通知が自動送信されます</li>
                <li>内部キャストの場合、Googleカレンダーに予定が自動作成されます</li>
                <li>同じ案件への追加オーダーは、既存のSlackスレッドに返信される形で通知されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>

    <!-- 3. キャスティング状況 -->
    <Card id="casting-status" class="section-card mb-4">
      <template #title>
        <i class="pi pi-chart-bar"></i> キャスティング状況
      </template>
      <template #content>
        <p class="section-intro">オーダー済みの全キャスティングのステータスを管理する画面です。</p>
        
        <Accordion>
          <AccordionPanel value="status-flow">
            <AccordionHeader>🔄 ステータスフロー</AccordionHeader>
            <AccordionContent>
              <div class="status-flow">
                <span class="status-tag provisional">仮キャスティング</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag inquiry">打診中</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag ok">OK</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag decided">決定</span>
              </div>
              <ul class="mt-2">
                <li><strong>仮キャスティング：</strong>オーダー送信直後の初期状態</li>
                <li><strong>打診中：</strong>事務所やキャストに打診を開始した状態</li>
                <li><strong>OK：</strong>キャストからOKの返答があった状態</li>
                <li><strong>決定：</strong>最終的にキャスティングが確定した状態</li>
                <li><strong>NG / キャンセル：</strong>不採用やキャンセル</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="status-views">
            <AccordionHeader>📊 表示モード</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>日付ビュー：</strong>撮影日ごとにグルーピングして表示</li>
                <li><strong>作品ビュー：</strong>作品名ごとにグルーピングして表示</li>
                <li><strong>テーブルビュー：</strong>一覧テーブルで全件表示</li>
                <li>各キャスティングのステータス変更はドロップダウンで操作</li>
                <li>ステータス変更時に自動でSlack通知・カレンダー更新・Notion同期が行われます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="edit-casting">
            <AccordionHeader>✏️ キャスティング編集</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>作品名の変更：</strong>作品名をクリックして編集可能。関連するcastMaster・shootingContactsも自動更新されます</li>
                <li><strong>日程の変更：</strong>日程変更はSlack通知・カレンダー更新と連動します</li>
                <li><strong>金額の入力：</strong>OK/決定時に金額を記録できます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>

    <!-- 4. 撮影連絡DB -->
    <Card id="shooting-contact" class="section-card mb-4">
      <template #title>
        <i class="pi pi-phone"></i> 撮影連絡DB
      </template>
      <template #content>
        <p class="section-intro">外部キャストの決定後フローを管理する画面です。香盤連絡から投稿日連絡まで一元管理できます。</p>
        
        <Accordion>
          <AccordionPanel value="contact-flow">
            <AccordionHeader>📋 ステータスフロー</AccordionHeader>
            <AccordionContent>
              <div class="status-flow">
                <span class="status-tag">香盤連絡待ち</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag">発注書送信待ち</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag">メイキング共有待ち</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag">投稿日連絡待ち</span>
                <i class="pi pi-arrow-right"></i>
                <span class="status-tag decided">完了</span>
              </div>
              <ul class="mt-2">
                <li>キャスティングが「OK」or「決定」になると自動で「香盤連絡待ち」として追加されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="contact-features">
            <AccordionHeader>📧 メール送信機能</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>香盤連絡メール：</strong>撮影日時・場所・作品名等を含むメールテンプレートを使用</li>
                <li><strong>発注書送付メール：</strong>発注書PDFを添付して送信</li>
                <li><strong>メイキング共有メール：</strong>オフショットDriveリンクを含むメール</li>
                <li><strong>投稿日連絡メール：</strong>投稿予定日の連絡</li>
                <li>各メールテンプレートは管理画面でカスタマイズ可能です</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="contact-sync">
            <AccordionHeader>🔄 香盤DB同期</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>香盤DBのIN/OUT時間・集合場所が自動反映されます（shootingDetailsコレクション経由）</li>
                <li>同期ボタンで手動反映も可能です</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>

    <!-- 5. 管理画面 -->
    <Card id="management" class="section-card mb-4">
      <template #title>
        <i class="pi pi-cog"></i> 管理画面
      </template>
      <template #content>
        <p class="section-intro">メールテンプレート設定やデータ管理を行う管理画面です。</p>
        
        <Accordion>
          <AccordionPanel value="email-template">
            <AccordionHeader>📝 メールテンプレート設定</AccordionHeader>
            <AccordionContent>
              <ul>
                <li>各フロー（香盤連絡・発注書送付・メイキング共有・投稿日連絡）のメールテンプレートを編集できます</li>
                <li>利用可能な変数：<code v-pre>{{撮影日}}</code> <code v-pre>{{キャスト名}}</code> <code v-pre>{{作品名}}</code> <code v-pre>{{役名}}</code> <code v-pre>{{金額}}</code> <code v-pre>{{時間}}</code> <code v-pre>{{集合場所}}</code> <code v-pre>{{住所}}</code> <code v-pre>{{notion}}</code> <code v-pre>{{アカウント}}</code> <code v-pre>{{GドライブURL}}</code> <code v-pre>{{投稿日}}</code></li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="data-management">
            <AccordionHeader>📂 データ管理</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>DB検索：</strong>キャスト名・作品名・アカウント名でキャスティングレコードを検索</li>
                <li><strong>日付変更：</strong>作品名を指定して、該当する全レコードの撮影日を一括変更</li>
                <li><strong>DB削除：</strong>不要なレコードの削除</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>

    <!-- 6. データ同期 -->
    <Card id="sync" class="section-card mb-4">
      <template #title>
        <i class="pi pi-sync"></i> データ同期の仕組み
      </template>
      <template #content>
        <p class="section-intro">各データソースの同期方法をまとめています。</p>
        
        <Accordion>
          <AccordionPanel value="sync-shootings">
            <AccordionHeader>📅 撮影スケジュール（shootings）</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>データソース：</strong>gokko-sam プロジェクト → notionSchedule コレクション</li>
                <li><strong>同期先：</strong>gokko-casty → shootings コレクション</li>
                <li><strong>同期方法：</strong>Cloud Functions <code>scheduledSyncFromSam</code> が2時間毎に自動実行</li>
                <li><strong>手動同期：</strong>Cloud Functions <code>syncScheduleFromSam</code> で手動実行可能</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="sync-casts">
            <AccordionHeader>👥 キャストデータ（casts）</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>データソース：</strong>スプレッドシート（Notion_FromDB + キャストリスト + 内部キャストDB）</li>
                <li><strong>同期方法：</strong>GAS <code>syncCastsToFirestore_()</code> で定期同期</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="sync-details">
            <AccordionHeader>🗓️ 香盤詳細（shootingDetails）</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>データソース：</strong>香盤スプレッドシートの「データ送信用シート」</li>
                <li><strong>同期方法：</strong>GAS（香盤.gas / 長編GAS.gas）の「決」ボタン押下時にFirestoreに書き込み</li>
                <li>キャスト名・IN/OUT時間・場所・住所・NotionPageIDが同期されます</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
          
          <AccordionPanel value="sync-offshot">
            <AccordionHeader>📸 オフショットDrive</AccordionHeader>
            <AccordionContent>
              <ul>
                <li><strong>データソース：</strong>スプレッドシート「オフショットDrive」</li>
                <li><strong>同期方法：</strong>GAS <code>syncOffshotDriveToFirestore_()</code> で定期同期</li>
                <li>Cloud Functions <code>syncDriveLinksToContacts</code> で撮影連絡DBに一括反映可能</li>
              </ul>
            </AccordionContent>
          </AccordionPanel>
        </Accordion>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.help-view {
  max-width: 900px;
  margin: 0 auto;
  padding: 1rem;
}

.help-hero {
  text-align: center;
  padding: 2rem 1rem 1rem;
}

.help-hero h1 {
  font-size: 2.25rem;
  font-weight: 700;
  color: var(--p-primary-color);
  margin-bottom: 0.25rem;
}

.help-hero h1 i {
  margin-right: 0.5rem;
}

.subtitle {
  font-size: 1.1rem;
  color: var(--p-text-muted-color);
}

/* TOC */
.toc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}

.toc-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: var(--p-content-hover-background);
  text-decoration: none;
  color: var(--p-text-color);
  font-weight: 500;
  transition: all 0.2s;
}

.toc-item:hover {
  background: var(--p-primary-50);
  color: var(--p-primary-color);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.toc-item i {
  font-size: 1.25rem;
  color: var(--p-primary-color);
}

/* Section Cards */
.section-card :deep(.p-card-title) {
  font-size: 1.4rem;
  color: var(--p-primary-color);
}

.section-card :deep(.p-card-title i) {
  margin-right: 0.5rem;
}

.section-intro {
  margin-bottom: 1rem;
  color: var(--p-text-muted-color);
  line-height: 1.6;
}

/* Status Flow */
.status-flow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.75rem;
  background: var(--p-content-hover-background);
  border-radius: 8px;
}

.status-tag {
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  background: var(--p-content-hover-background);
  color: var(--p-text-color);
}

.status-tag.provisional {
  background: #DBEAFE;
  color: #1D4ED8;
}

.status-tag.inquiry {
  background: #FEF3C7;
  color: #92400E;
}

.status-tag.ok {
  background: #D1FAE5;
  color: #065F46;
}

.status-tag.decided {
  background: #C7D2FE;
  color: #3730A3;
}

.status-flow .pi-arrow-right {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

/* Lists */
ul {
  padding-left: 1.25rem;
  line-height: 1.8;
}

ul li {
  margin-bottom: 0.25rem;
}

code {
  background: var(--p-content-hover-background);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.85em;
}
</style>
