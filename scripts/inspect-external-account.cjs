/**
 * mode=external / internal のキャスティングの accountName / projectName / roleName 分布を確認
 */
const admin = require('firebase-admin')
const path = require('path')

const serviceAccount = require(path.join(__dirname, 'serviceAccountKey.json'))
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

async function main() {
    const snap = await db.collection('castings').get()
    const external = []
    const internal = []
    for (const d of snap.docs) {
        const data = d.data()
        if (data.deleted === true) continue
        if (data.mode === 'external') external.push(data)
        else if (data.mode === 'internal') internal.push(data)
    }

    function summarize(label, items) {
        console.log()
        console.log(`=== ${label} (${items.length}件) ===`)
        const acctCnt = {}
        const projCnt = {}
        const roleCnt = {}
        for (const i of items) {
            acctCnt[i.accountName || '(empty)'] = (acctCnt[i.accountName || '(empty)'] || 0) + 1
            projCnt[i.projectName || '(empty)'] = (projCnt[i.projectName || '(empty)'] || 0) + 1
            roleCnt[i.roleName || '(empty)'] = (roleCnt[i.roleName || '(empty)'] || 0) + 1
        }
        const printTop = (title, m) => {
            console.log(`  --- ${title} top 10 ---`)
            for (const [k, v] of Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
                console.log(`    ${v.toString().padStart(3)} × "${k}"`)
            }
        }
        printTop('accountName', acctCnt)
        printTop('projectName', projCnt)
        printTop('roleName', roleCnt)
    }

    summarize('mode=external', external)
    summarize('mode=internal', internal)
}

main().catch(e => { console.error(e); process.exit(1) }).then(() => process.exit(0))
