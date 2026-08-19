#!/usr/bin/env python3
"""RBAC 完整 API 測試。"""
import json, urllib.request, urllib.error, sys

BASE = "http://localhost:3001/api/v1"
passed = failed = 0
fails = []

def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if token: r.add_header("Authorization", f"Bearer {token}")
    if data is not None: r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or "{}")
        except: return e.code, {}

def login(email, pw):
    st, d = req("POST", "/auth/login", body={"email": email, "password": pw})
    return d.get("data", {}).get("accessToken")

def check(name, got, want):
    global passed, failed
    ok = got == want
    if ok: passed += 1
    else:
        failed += 1; fails.append(f"{name}: got {got}, want {want}")
    print(f"  {'✓' if ok else '✗'} {name}: {got}" + ("" if ok else f" (want {want})"))

# ── 登入 ──
print("== 登入 + /me/permissions ==")
A = login("admin@open333crm.dev", "Admin1234!")
S = login("supervisor@open333crm.dev", "Super1234!")
G = login("agent@open333crm.dev", "Agent1234!")
check("admin 登入", bool(A), True)
check("supervisor 登入", bool(S), True)
check("agent 登入", bool(G), True)

st, d = req("GET", "/auth/me/permissions", A)
check("admin 權限數 49", len(d["data"]["permissions"]), 49)
st, d = req("GET", "/auth/me/permissions", S)
check("supervisor 有效權限 39(含 implies role.view)", len(d["data"]["permissions"]), 39)
st, d = req("GET", "/auth/me/permissions", G)
gperms = d["data"]["permissions"]
check("agent 權限數 22", len(gperms), 22)
check("agent 有 implies 補的 agent.view", "agent.view" in gperms, True)
check("agent 無 role.manage", "role.manage" in gperms, False)

# ── 角色 API 全端點 ──
print("\n== 角色 API 端點 ==")
check("GET /roles admin", req("GET", "/roles", A)[0], 200)
check("GET /roles agent(無 role.view)", req("GET", "/roles", G)[0], 403)
check("GET /roles/matrix admin", req("GET", "/roles/matrix", A)[0], 200)
st, d = req("GET", "/roles/matrix", A)
check("matrix 有 groups", len(d["data"]["groups"]) > 0, True)
# 取 admin role id
st, d = req("GET", "/roles", A)
roles = {r["slug"]: r["id"] for r in d["data"]["roles"]}
check("三 system role 存在", sorted(roles.keys()), ["admin","agent","supervisor"])
st, d = req("GET", f"/roles/{roles['supervisor']}/permissions", A)
check("GET supervisor 權限 38", len(d["data"]["permissions"]), 38)

# ── 建立/改名/刪除自訂角色 ──
print("\n== 自訂角色 CRUD ==")
st, d = req("POST", "/roles", A, {"name": "測試角色X"})
check("建立自訂角色 201", st, 201)
rid = d["data"]["id"]
check("新角色 isSystem=false", d["data"]["isSystem"], False)
st, d = req("GET", f"/roles/{rid}/permissions", A)
check("新角色 0 權限(空白建立)", len(d["data"]["permissions"]), 0)
check("撞名 422", req("POST", "/roles", A, {"name": "測試角色X"})[0], 422)
check("改名 200", req("PATCH", f"/roles/{rid}", A, {"name": "測試角色Y"})[0], 200)
check("agent 建角色(無 role.manage) 403", req("POST", "/roles", G, {"name": "z"})[0], 403)

# ── 權限指派守門 ──
print("\n== 權限指派守門 ==")
check("缺 dependsOn(reply 無 view) 422", req("PUT", f"/roles/{rid}/permissions", A, {"permissions": ["inbox.reply"]})[0], 422)
check("未知碼 422", req("PUT", f"/roles/{rid}/permissions", A, {"permissions": ["fake.code"]})[0], 422)
check("正確設權限 200", req("PUT", f"/roles/{rid}/permissions", A, {"permissions": ["inbox.view","marketing.view","marketing.manage","marketing.broadcast"]})[0], 200)
st, d = req("GET", f"/roles/{rid}/permissions", A)
check("設定後 4 權限", len(d["data"]["permissions"]), 4)
# admin 防自鎖
check("admin 移除自己 role.manage 422", req("PUT", f"/roles/{roles['admin']}/permissions", A, {"permissions": ["inbox.view"]})[0], 422)
# supervisor 越權
check("sup 授予越權 channel.create 403", req("PUT", f"/roles/{rid}/permissions", S, {"permissions": ["channel.view","channel.create"]})[0], 403)

# ── 刪除守門 ──
print("\n== 刪除守門 ==")
check("刪 system role(agent) 403", req("DELETE", f"/roles/{roles['agent']}", A)[0], 403)
check("刪空的自訂角色 200", req("DELETE", f"/roles/{rid}", A)[0], 200)

# ── 切換模組可達性（三角色）──
print("\n== 模組可達性 (admin/sup/agent) ==")
def triple(name, method, path, want_a, want_s, want_g, body=None):
    a = req(method, path, A, body)[0]
    s = req(method, path, S, body)[0]
    g = req(method, path, G, body)[0]
    check(f"{name} admin", a, want_a)
    check(f"{name} sup", s, want_s)
    check(f"{name} agent", g, want_g)

triple("GET /analytics/overview", "GET", "/analytics/overview", 200, 200, 403)
triple("GET /settings/office-hours", "GET", "/settings/office-hours", 200, 200, 403)
triple("GET /sla-policies", "GET", "/sla-policies", 200, 200, 403)
triple("GET /marketing/segments", "GET", "/marketing/segments", 200, 200, 403)
triple("GET /channels", "GET", "/channels", 200, 200, 403)
triple("GET /automation/rules", "GET", "/automation/rules", 200, 200, 403)
triple("GET /portal/activities", "GET", "/portal/activities", 200, 403, 403)
# rich-menus 需 query param, admin/sup 過權限後 400(驗證), agent 403(權限)
ra=req("GET","/line/rich-menus",A)[0]; rs=req("GET","/line/rich-menus",S)[0]; rg=req("GET","/line/rich-menus",G)[0]
check("rich-menus admin 過權限(非403)", ra!=403, True)
check("rich-menus sup 過權限(非403)", rs!=403, True)
check("rich-menus agent 擋(403)", rg, 403)
triple("GET /webhook-subscriptions", "GET", "/webhook-subscriptions", 200, 200, 403)
triple("GET /agents", "GET", "/agents", 200, 200, 200)
triple("GET /conversations", "GET", "/conversations", 200, 200, 200)
triple("GET /cases", "GET", "/cases", 200, 200, 200)

print(f"\n{'='*40}")
print(f"結果: {passed} passed, {failed} failed")
if fails:
    print("失敗項:")
    for f in fails: print("  -", f)
sys.exit(1 if failed else 0)
