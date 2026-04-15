import { ref } from 'vue'
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import { useToast } from 'primevue/usetoast'

/**
 * PDF生成用のデータ型（旧バージョン）
 * OrderPdfModal の編集フォームから渡される
 */
export interface OrderDocumentData {
    date: string        // 発行日
    agencyName: string  // 事務所名（空ならキャスト名宛）
    castName: string    // キャスト名
    project: string     // 案件名
    role: string        // 役名
    shootDate: string   // 撮影日
    cost: string        // 金額（半角数字 or ¥付き文字列）
    note: string        // 備考
    uuid: string        // 発注書番号
}

/**
 * PDF生成用のデータ型（新バージョン V2）
 * リファレンスPDF「見本で見たやつ.pdf」準拠のビジネス文書形式
 */
export interface OrderDocumentDataV2 {
    // 基本情報
    orderDate: string         // 発注日 (YYYY-MM-DD or YYYY/M/D)
    orderNumber: string       // 発注書番号 (P-ORxxxxxx-xxxx)
    // 宛先（事務所）
    recipientName: string     // 事務所名 / 宛名
    recipientPostal: string   // 郵便番号
    recipientAddress: string  // 住所
    // 発注者（GOKKO 固定）
    issuerName: string        // 発注者名（担当者名）
    // 件名
    subject: string           // 件名（案件名+出演 等）
    // 明細
    itemDescription: string   // 摘要（例: "ドラマ出演料"）
    itemQuantity: number      // 数量
    itemUnit: string          // 単位（式 等）
    itemUnitPrice: number     // 単価（税抜）
    // 納品/支払
    deliveryDate: string      // 納品期限
    deliveryPlace: string     // 納品場所
    paymentDate: string       // 支払予定日
    // その他
    castName: string          // キャスト名（ファイル名用）
    note: string              // 備考（追加）
}

/**
 * PDF生成composable
 * ORDER_DOCUMENT_SPEC.md Section 5-8 準拠
 */
export function usePdfGenerator() {
    const loading = ref(false)
    const toast = useToast()

    /**
     * 金額フォーマット（Section 6 準拠）
     */
    function formatCost(raw: string): string {
        if (!raw) return '未定'
        const numCost = Number(raw.replace(/[^0-9]/g, ''))
        if (numCost > 0 && !raw.includes('¥')) {
            return `¥${numCost.toLocaleString()}`
        }
        return raw
    }

    /**
     * 発注書PDFを生成（Section 5 レイアウト準拠）
     */
    async function generateOrderDocument(data: OrderDocumentData): Promise<void> {
        loading.value = true

        try {
            const costStr = formatCost(data.cost)

            const html = `
                <div id="pdf-container" style="
                    width: 595px;
                    min-height: 842px;
                    padding: 45px 40px 30px;
                    font-family: 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
                    font-size: 11px;
                    line-height: 1.7;
                    color: #1a1a1a;
                    background: white;
                    box-sizing: border-box;
                ">
                    <!-- タイトル -->
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="font-size: 20px; font-weight: 700; letter-spacing: 6px; margin: 0;">
                            GOKKO倶楽部出演発注書
                        </h1>
                    </div>

                    <!-- 日付 + 発注書番号 -->
                    <div style="text-align: right; margin-bottom: 5px; font-size: 11px;">
                        ${data.date}
                    </div>
                    <div style="text-align: right; margin-bottom: 20px; font-size: 9px; color: #888;">
                        No. ${data.uuid}
                    </div>

                    <!-- 宛名: 事務所名があれば「事務所名宛」、なければ「キャスト名宛」 -->
                    <div style="margin-bottom: 20px; font-size: 15px; font-weight: 600; border-bottom: 2px solid #333; padding-bottom: 6px;">
                        ${data.agencyName ? data.agencyName + ' 宛' : data.castName + ' 様'}
                    </div>

                    <!-- 挨拶文 -->
                    <div style="margin-bottom: 18px; font-size: 10.5px; line-height: 1.8;">
                        ご快諾いただきましたドラマ出演の件につきまして、下記の通り発注申し上げます。<br>
                        内容をご確認いただき、ご不明な点がございましたら担当までご連絡ください。
                    </div>

                    <!-- 発注元情報 -->
                    <div style="margin-bottom: 18px; font-size: 10px; line-height: 1.8;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【発注元】</div>
                        〒135-0091<br>
                        東京都港区台場2-3-1トレードピアお台場12F<br>
                        株式会社GOKKO<br>
                        担当：GOKKO倶楽部キャスティング担当
                    </div>

                    <!-- お取引条件 -->
                    <div style="margin-bottom: 18px; font-size: 10px; line-height: 1.8;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【お取引条件】</div>
                        支払条件：月末締め翌月末払い<br>
                        支払方法：ご指定の銀行口座へお振込み<br>
                        秘密保持：本件に関わる脚本内容、撮影情報、共演者情報等は、公式解禁まで第三者への漏洩（SNS含む）を禁止
                    </div>

                    <!-- 「以上」 -->
                    <div style="text-align: right; margin-bottom: 20px; font-size: 10.5px;">以上</div>

                    <!-- 「記」 -->
                    <div style="text-align: center; margin-bottom: 15px; font-size: 14px; font-weight: 600;">記</div>

                    <!-- 明細テーブル -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px;">
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; width: 100px; text-align: center;">案件名</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.project}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">役名</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.role || '－'}</td>
                        </tr>
                        ${data.agencyName ? `
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">キャスト名</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.castName} 様</td>
                        </tr>
                        ` : ''}
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">撮影日</td>
                            <td style="padding: 8px 12px; border: 1px solid #999;">${data.shootDate || '未定'}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 12px; border: 1px solid #999; background: #f0f0f0; font-weight: 600; text-align: center;">出演料</td>
                            <td style="padding: 8px 12px; border: 1px solid #999; font-weight: 600;">${costStr}（税別）</td>
                        </tr>
                    </table>

                    ${data.note ? `
                    <div style="margin-bottom: 15px; font-size: 10px;">
                        <div style="font-weight: 600; margin-bottom: 4px;">【備考】</div>
                        <div style="white-space: pre-wrap;">${data.note}</div>
                    </div>
                    ` : ''}
                </div>
            `

            // 一時的なDOM要素を画面外に作成
            const container = document.createElement('div')
            container.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;'
            container.innerHTML = html
            document.body.appendChild(container)

            const pdfElement = container.querySelector('#pdf-container') as HTMLElement

            // html2canvas でキャプチャ (scale:2 for高精細)
            const canvas = await html2canvas(pdfElement, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                width: 595,
                windowWidth: 595
            })

            // jsPDF で A4 PDF 作成
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4'
            })

            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()
            const imgWidth = pageWidth
            const imgHeight = (canvas.height * imgWidth) / canvas.width

            pdf.addImage(
                canvas.toDataURL('image/png'),
                'PNG',
                0, 0,
                imgWidth,
                Math.min(imgHeight, pageHeight)
            )

            // ファイル名: {撮影日}_{案件名}_{キャスト名}様_発注書.pdf (Section 8)
            const shootDateClean = data.shootDate.replace(/[\/\-\.年月日]/g, '')
            const fileName = `${shootDateClean || 'undated'}_${data.project}_${data.castName}様_発注書.pdf`
            pdf.save(fileName)

            // DOM要素クリーンアップ
            document.body.removeChild(container)

            toast.add({
                severity: 'success',
                summary: 'PDF生成完了',
                detail: `${fileName} をダウンロードしました`,
                life: 3000
            })

        } catch (error) {
            console.error('Error generating PDF:', error)
            toast.add({
                severity: 'error',
                summary: 'PDF生成エラー',
                detail: 'PDFの生成に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * 新バージョン発注書PDFを生成（リファレンスPDF準拠）
     * 事務所向けビジネス文書形式: 税計算・明細テーブル・備考定型文付き
     */
    async function generateOrderDocumentV2(data: OrderDocumentDataV2): Promise<void> {
        loading.value = true

        try {
            const subtotal = data.itemQuantity * data.itemUnitPrice
            const tax = Math.round(subtotal * 0.1)
            const total = subtotal + tax
            const fmtNum = (n: number) => n.toLocaleString()

            // 備考定型文
            const defaultRemarks = [
                '・本発注取引に関するお問い合わせの際は「書類番号」を担当者宛にお知らせ下さい。',
                '・住所、振込口座等、お取引先様に関する記載につき、その内容に相違がある場合には、担当者宛にご連絡下さい。',
                '・成果物等のご納品の際には、納品書（貴社/貴殿にてご使用の適宜の様式で結構です。）と合わせて、担当者宛にお渡し下さい。',
                '・ご請求の際には、請求書（貴社/貴殿にてご使用の適宜の様式で結構です。）を担当者にお渡し下さい。',
                '・本発注取引に関するお支払い方法は「毎月末締め、翌月末支払い」となります。（お取引先様との別途の契約等に基づく合意等がある場合は当該合意等に定める条件によります。）（月末が土日祝日及び金融機関の休業日となる場合は、その直前の金融機関営業日となります。）',
                '・本発注取引に関して、弊社から貸与等した資料等並びに弊社から開示した秘密情報及び個人情報につきましては、細心の注意をもって取扱い及び適切な管理をお願いいたします。',
                '・本発注取引に基づき発生した権利及び義務については、弊社の事前の書面による承諾を得ることなく、その全部若しくは一部を第三者へ譲渡し、担保に供し又は承継させることはできません。',
            ].join('\n')

            const userNote = data.note ? `\n\n${data.note}` : ''

            const html = `
                <div id="pdf-container" style="
                    width: 595px;
                    min-height: 842px;
                    padding: 35px 35px 25px;
                    font-family: 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif;
                    font-size: 10px;
                    line-height: 1.6;
                    color: #1a1a1a;
                    background: white;
                    box-sizing: border-box;
                ">
                    <!-- タイトル -->
                    <div style="text-align: center; margin-bottom: 22px;">
                        <h1 style="font-size: 22px; font-weight: 700; letter-spacing: 8px; margin: 0;">発注書</h1>
                    </div>

                    <!-- 上段: 宛先 + 発注日/番号 + 発注者情報 -->
                    <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
                        <!-- 左: 宛先 -->
                        <div style="flex: 1;">
                            <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px;">
                                ${data.recipientName} 御中
                            </div>
                            ${data.recipientPostal ? `<div style="font-size: 9px; color: #555;">${data.recipientPostal}</div>` : ''}
                            ${data.recipientAddress ? `<div style="font-size: 9px; color: #555;">${data.recipientAddress}</div>` : ''}
                        </div>
                        <!-- 右: 発注日 + 番号 -->
                        <div style="text-align: right; font-size: 9.5px;">
                            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-bottom: 2px;">
                                <span style="font-weight: 600;">発注日</span>
                                <span>${data.orderDate}</span>
                            </div>
                            <div style="display: flex; justify-content: flex-end; gap: 12px;">
                                <span style="font-weight: 600;">発注書番号</span>
                                <span>${data.orderNumber}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 発注者情報（GOKKO） -->
                    <div style="text-align: right; margin-bottom: 18px; font-size: 9px; line-height: 1.7;">
                        <div style="font-weight: 700; font-size: 11px; margin-bottom: 2px;">株式会社GOKKO</div>
                        <div>${data.issuerName || 'GOKKO倶楽部キャスティング担当'}</div>
                        <div>〒135-0091</div>
                        <div>東京都港区台場2-3-1トレードピアお台場12F</div>
                    </div>

                    <!-- 件名 -->
                    <div style="margin-bottom: 14px; font-size: 10px;">
                        <span style="font-weight: 700;">件名</span>
                        <span style="margin-left: 12px;">${data.subject}</span>
                    </div>

                    <!-- 金額サマリー -->
                    <table style="border-collapse: collapse; margin-bottom: 16px;">
                        <tr>
                            <td style="padding: 5px 14px; border: 1px solid #333; font-weight: 600; font-size: 9.5px; background: #f5f5f5;">小計</td>
                            <td style="padding: 5px 14px; border: 1px solid #333; font-weight: 600; font-size: 9.5px; background: #f5f5f5;">消費税</td>
                            <td style="padding: 5px 14px; border: 1px solid #333; font-weight: 700; font-size: 9.5px; background: #f5f5f5;">発注金額</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 14px; border: 1px solid #333; font-size: 10px; text-align: right;">${fmtNum(subtotal)}円</td>
                            <td style="padding: 6px 14px; border: 1px solid #333; font-size: 10px; text-align: right;">${fmtNum(tax)}円</td>
                            <td style="padding: 6px 14px; border: 1px solid #333; font-size: 16px; font-weight: 700; text-align: right;">${fmtNum(total)}円</td>
                        </tr>
                    </table>

                    <!-- 明細テーブル -->
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9.5px;">
                        <tr style="background: #f5f5f5;">
                            <td style="padding: 5px 8px; border: 1px solid #999; font-weight: 600; text-align: center; width: 50%;">摘要</td>
                            <td style="padding: 5px 8px; border: 1px solid #999; font-weight: 600; text-align: center; width: 12%;">数量</td>
                            <td style="padding: 5px 8px; border: 1px solid #999; font-weight: 600; text-align: center; width: 18%;">単価</td>
                            <td style="padding: 5px 8px; border: 1px solid #999; font-weight: 600; text-align: center; width: 20%;">明細金額</td>
                        </tr>
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #999;">${data.itemDescription}</td>
                            <td style="padding: 6px 8px; border: 1px solid #999; text-align: center;">${data.itemQuantity} ${data.itemUnit}</td>
                            <td style="padding: 6px 8px; border: 1px solid #999; text-align: right;">${fmtNum(data.itemUnitPrice)}</td>
                            <td style="padding: 6px 8px; border: 1px solid #999; text-align: right;">${fmtNum(subtotal)}</td>
                        </tr>
                        <!-- 空行（余白） -->
                        ${[1,2,3].map(() => `
                        <tr>
                            <td style="padding: 6px 8px; border: 1px solid #999;">&nbsp;</td>
                            <td style="padding: 6px 8px; border: 1px solid #999;"></td>
                            <td style="padding: 6px 8px; border: 1px solid #999;"></td>
                            <td style="padding: 6px 8px; border: 1px solid #999;"></td>
                        </tr>
                        `).join('')}
                    </table>

                    <!-- 税内訳 (右寄せ) -->
                    <div style="display: flex; justify-content: flex-end; margin-bottom: 14px;">
                        <table style="border-collapse: collapse; font-size: 9px;">
                            <tr>
                                <td style="padding: 3px 10px; border: 1px solid #999; font-weight: 600;">内訳</td>
                                <td style="padding: 3px 10px; border: 1px solid #999; font-weight: 600;">10%対象(税抜)</td>
                                <td style="padding: 3px 10px; border: 1px solid #999; text-align: right;">${fmtNum(subtotal)}円</td>
                            </tr>
                            <tr>
                                <td style="padding: 3px 10px; border: 1px solid #999;"></td>
                                <td style="padding: 3px 10px; border: 1px solid #999;">10%消費税</td>
                                <td style="padding: 3px 10px; border: 1px solid #999; text-align: right;">${fmtNum(tax)}円</td>
                            </tr>
                        </table>
                    </div>

                    <!-- 納品/支払情報 -->
                    <div style="margin-bottom: 12px; font-size: 9.5px; line-height: 1.8;">
                        <div><span style="font-weight: 600;">納品期限</span><span style="margin-left: 12px;">${data.deliveryDate || '別途指定'}</span></div>
                        <div><span style="font-weight: 600;">納品場所</span><span style="margin-left: 12px;">${data.deliveryPlace || '東京都港区台場2-3-1トレードピアお台場12F'}</span></div>
                        <div><span style="font-weight: 600;">支払予定日</span><span style="margin-left: 6px;">${data.paymentDate || '月末締め翌月末払い'}</span></div>
                    </div>

                    <!-- 備考 -->
                    <div style="border: 1px solid #999; padding: 8px 10px; font-size: 8px; line-height: 1.6;">
                        <div style="font-weight: 600; margin-bottom: 4px;">備考</div>
                        <div style="white-space: pre-wrap;">${defaultRemarks}${userNote}</div>
                    </div>
                </div>
            `

            // 一時的なDOM要素を画面外に作成
            const container = document.createElement('div')
            container.style.cssText = 'position: fixed; left: -9999px; top: 0; z-index: -1;'
            container.innerHTML = html
            document.body.appendChild(container)

            const pdfElement = container.querySelector('#pdf-container') as HTMLElement

            const canvas = await html2canvas(pdfElement, {
                scale: 2,
                useCORS: true,
                backgroundColor: '#ffffff',
                width: 595,
                windowWidth: 595
            })

            const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
            const pageWidth = pdf.internal.pageSize.getWidth()
            const pageHeight = pdf.internal.pageSize.getHeight()
            const imgWidth = pageWidth
            const imgHeight = (canvas.height * imgWidth) / canvas.width

            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, Math.min(imgHeight, pageHeight))

            // ファイル名
            const dateClean = data.orderDate.replace(/[\/\-\.年月日]/g, '')
            const fileName = `${dateClean || 'undated'}_${data.subject}_${data.castName}様_発注書.pdf`
            pdf.save(fileName)

            document.body.removeChild(container)

            toast.add({
                severity: 'success',
                summary: 'PDF生成完了',
                detail: `${fileName} をダウンロードしました`,
                life: 3000
            })
        } catch (error) {
            console.error('Error generating V2 PDF:', error)
            toast.add({
                severity: 'error',
                summary: 'PDF生成エラー',
                detail: 'PDFの生成に失敗しました',
                life: 3000
            })
        } finally {
            loading.value = false
        }
    }

    /**
     * 複数の発注書を一括生成
     */
    async function generateBulkOrderDocuments(dataList: OrderDocumentData[]): Promise<void> {
        for (const data of dataList) {
            await generateOrderDocument(data)
        }
    }

    return {
        loading,
        generateOrderDocument,
        generateOrderDocumentV2,
        generateBulkOrderDocuments
    }
}
