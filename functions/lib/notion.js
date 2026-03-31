"use strict";
/**
 * Notion API ヘルパー
 * OK/決定ステータス時にNotionページのキャスト情報を更新
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCastToNotion = syncCastToNotion;
exports.createNotionCastPage = createNotionCastPage;
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
async function createNotionCastPage(params) {
    const { notionToken, databaseId, castId, name, gender, agency, email } = params;
    if (!notionToken || !databaseId || !castId || !name) {
        console.error("createNotionCastPage: missing required params");
        return null;
    }
    const url = "https://api.notion.com/v1/pages";
    const headers = {
        "Authorization": `Bearer ${notionToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    };
    // プロパティ構築
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const properties = {
        // 「名前」= title プロパティ
        "名前": {
            title: [{ text: { content: name } }],
        },
        // CastID = rich_text
        "CastID": {
            rich_text: [{ text: { content: castId } }],
        },
    };
    // 性別 (select)
    if (gender) {
        properties["性別"] = { select: { name: gender } };
    }
    // 事務所 (rich_text)
    if (agency) {
        properties["事務所"] = {
            rich_text: [{ text: { content: agency } }],
        };
    }
    // 連絡先 (email)
    if (email) {
        properties["連絡先"] = { email: email };
    }
    const body = {
        parent: { database_id: databaseId },
        properties,
    };
    try {
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error("Notion createPage failed:", errorText);
            return null;
        }
        const data = await response.json();
        console.log(`Created Notion cast page: ${name} (${castId}) → ${data.id}`);
        return data.id;
    }
    catch (error) {
        console.error("Notion createPage error:", error);
        return null;
    }
}
//# sourceMappingURL=notion.js.map