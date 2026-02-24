"use strict";
/**
 * Notion API ヘルパー
 * OK/決定ステータス時にNotionページのキャスト情報を更新
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCastToNotion = syncCastToNotion;
/**
 * Notionページにキャスト情報を同期
 * multi_selectプロパティ（メインキャスト/サブキャスト/内部キャスト）に追加
 */
async function syncCastToNotion(params) {
    const { notionToken, pageId, castName, isInternal, mainSub } = params;
    if (!notionToken || !pageId)
        return false;
    // プロパティ名の決定
    let targetPropName = "サブキャスト";
    if (isInternal) {
        targetPropName = "内部キャスト";
    }
    else if (mainSub === "メイン") {
        targetPropName = "メインキャスト";
    }
    const pageIdFormatted = pageId.replace(/-/g, "");
    const url = `https://api.notion.com/v1/pages/${pageIdFormatted}`;
    const headers = {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
    try {
        // 現在のプロパティを取得
        const getResponse = await fetch(url, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${notionToken}`,
                "Notion-Version": "2022-06-28",
            },
        });
        const pageData = await getResponse.json();
        const currentTags = pageData.properties?.[targetPropName]?.multi_select || [];
        // 既に存在するか確認
        const exists = currentTags.some((tag) => tag.name === castName);
        if (exists) {
            console.log(`Cast "${castName}" already exists in Notion property "${targetPropName}"`);
            return true;
        }
        // 新規追加
        currentTags.push({ name: castName });
        const updatePayload = {
            properties: {
                [targetPropName]: {
                    multi_select: currentTags,
                },
            },
        };
        const updateResponse = await fetch(url, {
            method: "PATCH",
            headers,
            body: JSON.stringify(updatePayload),
        });
        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            console.error("Notion update failed:", errorText);
            return false;
        }
        console.log(`Synced cast "${castName}" to Notion property "${targetPropName}"`);
        return true;
    }
    catch (error) {
        console.error("Notion sync error:", error);
        return false;
    }
}
//# sourceMappingURL=notion.js.map