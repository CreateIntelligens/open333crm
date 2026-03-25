--
-- PostgreSQL database dump
--

\restrict a6RFR96wn8X4TWaQmfc9iT1EBudIGvbKNVuMeeF5PUY7KPuWixyx7JixjhaSfev

-- Dumped from database version 16.13 (Debian 16.13-1.pgdg12+1)
-- Dumped by pg_dump version 16.13 (Debian 16.13-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public._prisma_migrations VALUES ('83fc3163-008e-4f32-8e43-fb1a840309c2', '67b542f7ca430f41c7c654f94877714856a8b0d94a731bc1d52ab81034249c08', '2026-03-24 01:08:21.682265+00', '20260317024210_init', NULL, NULL, '2026-03-24 01:08:21.354733+00', 1);
INSERT INTO public._prisma_migrations VALUES ('75ba7085-d5d4-461b-8529-56b3e86ca679', '0787253e8076e86c85f531a473d2546ca3f244008e9e03bd8e598887c6dd6179', '2026-03-24 01:08:21.691099+00', '20260317072643_inbox_enhancements', NULL, NULL, '2026-03-24 01:08:21.683046+00', 1);
INSERT INTO public._prisma_migrations VALUES ('692ac40a-997e-4ddb-b79e-9680e5a6375f', '68cd7e6b93f4159b63781d00950e590bb8813678ae04b5656f4163f0cd67691f', '2026-03-24 01:08:21.693147+00', '20260317092629_add_contact_merge_fields', NULL, NULL, '2026-03-24 01:08:21.691618+00', 1);
INSERT INTO public._prisma_migrations VALUES ('7da1c424-82a6-4053-ae25-dcde97c9b032', '515e4ae41acd512049126a6ec722af24cb871e942411baa5ff814ca56da30556', '2026-03-24 01:08:21.719216+00', '20260318010000_embedding_vector_1024', NULL, NULL, '2026-03-24 01:08:21.693614+00', 1);
INSERT INTO public._prisma_migrations VALUES ('baf9248b-25a5-4c9f-9aa8-3d5b9829bbe7', '2d4a4327955fb8feaa53e591b14115beb5384902b9693727a2f1d3b94c6441f3', '2026-03-24 01:08:21.729365+00', '20260319013523_add_notifications', NULL, NULL, '2026-03-24 01:08:21.719781+00', 1);
INSERT INTO public._prisma_migrations VALUES ('cf296423-ed58-479c-91b3-b04fd642970a', '3dbc632c1911a1191a3e224117d18119d33c3d6da3fe93664a351321ba4e35b6', '2026-03-24 01:08:21.734229+00', '20260319015814_add_daily_stats', NULL, NULL, '2026-03-24 01:08:21.729831+00', 1);
INSERT INTO public._prisma_migrations VALUES ('4dcc7a1c-15e5-4af2-81fd-d3bb95792796', 'e4471183903d7c993b54a60b4e7f99ab66c456ae658b11b3da663c37ca90b9b8', '2026-03-24 01:08:21.755063+00', '20260319030112_add_marketing_models', NULL, NULL, '2026-03-24 01:08:21.734741+00', 1);
INSERT INTO public._prisma_migrations VALUES ('e67c06f0-c56d-42dd-827c-3d3679d5d33b', '7b882e3f3b8e5793ec2d587ec0fb1b25b322daf697112a25b54c76a06345dbe1', '2026-03-24 01:08:21.763268+00', '20260319032849_add_broadcast_recipients', NULL, NULL, '2026-03-24 01:08:21.755572+00', 1);
INSERT INTO public._prisma_migrations VALUES ('6b7f7b42-ac20-48da-9a38-d147a279aa28', '453ad23dc8d4bfecc496a29f925f710c12a43d1798bb987ac2a11624937d0345', '2026-03-24 01:08:21.765311+00', '20260320045647_add_csat_fields', NULL, NULL, '2026-03-24 01:08:21.763695+00', 1);
INSERT INTO public._prisma_migrations VALUES ('47cb1f85-0602-4174-a343-c195672e3e81', '9aef393297d39a9394ee7d257d76bfac0fdfb49dfc54d89d7ca19e53cb14eac1', '2026-03-24 01:08:56.67828+00', '20260324010856_add_portal_and_shortlink', NULL, NULL, '2026-03-24 01:08:56.644939+00', 1);


--
-- Data for Name: agents; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.agents VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin@demo.com', '林芳', NULL, 'ADMIN', true, '$2a$10$TBKA5uTeSnvZXC/qWh8WouaQ87blOF.VSwJTk7C9BWp0kH78KfrXO', '2026-03-24 01:09:23.658', '2026-03-24 01:09:23.658');
INSERT INTO public.agents VALUES ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'supervisor@demo.com', '陳主任', NULL, 'SUPERVISOR', true, '$2a$10$TBKA5uTeSnvZXC/qWh8WouaQ87blOF.VSwJTk7C9BWp0kH78KfrXO', '2026-03-24 01:09:23.668', '2026-03-24 01:09:23.668');
INSERT INTO public.agents VALUES ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'agent1@demo.com', '王小華', NULL, 'AGENT', true, '$2a$10$TBKA5uTeSnvZXC/qWh8WouaQ87blOF.VSwJTk7C9BWp0kH78KfrXO', '2026-03-24 01:09:23.67', '2026-03-24 01:09:23.67');


--
-- Data for Name: teams; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.teams VALUES ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '客服一部', '2026-03-24 01:09:23.671');


--
-- Data for Name: agent_team_members; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.agent_team_members VALUES ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
INSERT INTO public.agent_team_members VALUES ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001');
INSERT INTO public.agent_team_members VALUES ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001');


--
-- Data for Name: automation_rules; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'VIP 客戶投訴自動升級', '當 VIP 客戶訊息包含「投訴」或「檢舉」時，自動建立緊急案件並通知主管', true, 100, true, '{"type": "keyword.matched", "keywords": ["投訴", "檢舉"], "match_mode": "any"}', '{"all": [{"fact": "is_vip_customer", "value": true, "operator": "equal"}]}', '[{"type": "create_case", "params": {"title": "VIP客訴自動升級案件", "category": "客訴", "priority": "URGENT"}}, {"type": "notify_supervisor", "params": {"message": "VIP客戶投訴，請立即處理"}}]', 0, NULL, '2026-03-24 01:09:23.761', '2026-03-24 01:09:23.761');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '一般問題自動開案', '對話中尚無工單時自動建立諮詢案件並自動派單', true, 3, false, '{"type": "message.received"}', '{"all": [{"fact": "case.open.count", "value": 0, "operator": "equal"}]}', '[{"type": "create_case", "params": {"title": "客戶諮詢", "category": "諮詢", "priority": "MEDIUM"}}, {"type": "auto_assign", "params": {}}]', 1, '2026-03-24 01:39:53.357', '2026-03-24 01:09:23.764', '2026-03-24 01:39:53.358');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '故障關鍵字自動開案', '當客戶訊息包含故障相關關鍵字時，自動建立維修案件並加上標籤', true, 10, false, '{"type": "keyword.matched", "keywords": ["故障", "壞掉", "不動", "無法使用", "不能用", "當機"], "match_mode": "any"}', '{"all": []}', '[{"type": "create_case", "params": {"title": "自動開案：客戶提報故障", "category": "維修", "priority": "HIGH"}}, {"type": "add_tag", "params": {"tagName": "客訴"}}, {"type": "send_message", "params": {"text": "我已經為您建立維修服務單，將盡快安排技師為您處理。請問方便提供您的產品型號和購買時間嗎？"}}]', 3, '2026-03-24 02:21:10.893', '2026-03-24 01:09:23.76', '2026-03-24 02:21:10.894');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '歡迎訊息', '新對話建立時，自動發送歡迎訊息', true, 10, false, '{"type": "conversation.created"}', '{"all": []}', '[{"type": "send_message", "params": {"text": "您好！歡迎聯繫 Open333 客服 😊 請問有什麼可以幫您的？我是 AI 智能助手，也可以隨時輸入「真人」轉接客服人員。"}}]', 0, NULL, '2026-03-24 01:09:23.762', '2026-03-24 01:09:23.762');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '產品諮詢自動回覆', '當客戶問及保固、維修、退換貨等關鍵字時，自動搜尋知識庫回覆', true, 8, false, '{"type": "keyword.matched", "keywords": ["保固", "維修", "退貨", "換貨", "退款", "安裝", "配送", "送貨"], "match_mode": "any"}', '{"all": []}', '[{"type": "kb_auto_reply", "params": {}}]', 0, NULL, '2026-03-24 01:09:23.762', '2026-03-24 01:09:23.762');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '客訴自動開案 + 升級', '客戶投訴時自動建立高優先工單、加標籤、通知主管', true, 9, true, '{"type": "keyword.matched", "keywords": ["投訴", "客訴", "不滿", "太差", "很爛", "糟糕", "生氣", "找主管"], "match_mode": "any"}', '{"all": []}', '[{"type": "create_case", "params": {"title": "客訴處理", "category": "客訴", "priority": "HIGH"}}, {"type": "add_tag", "params": {"tagName": "客訴"}}, {"type": "notify_supervisor", "params": {"message": "有客戶提出投訴，請注意處理"}}, {"type": "send_message", "params": {"text": "非常抱歉造成您的不便，我已經為您建立服務案件，將由專人盡速為您處理。"}}]', 3, '2026-03-24 02:21:11.117', '2026-03-24 01:09:23.763', '2026-03-24 02:21:11.118');
INSERT INTO public.automation_rules VALUES ('a3000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '負面情緒通知', '偵測到客戶負面情緒時通知主管', true, 7, false, '{"type": "sentiment.negative"}', '{"all": []}', '[{"type": "notify_supervisor", "params": {"message": "偵測到客戶負面情緒，請關注此對話"}}]', 0, NULL, '2026-03-24 01:09:23.764', '2026-03-24 01:09:23.764');
INSERT INTO public.automation_rules VALUES ('b8b9de41-aafa-4965-8689-4f33a7529ebf', 'a0000000-0000-0000-0000-000000000001', 'LLM 智能回覆', '使用 AI 智能理解並回覆客戶所有訊息', true, 1, false, '{"type": "message.received"}', '{"all": []}', '[{"type": "llm_reply", "params": {}}]', 3, '2026-03-24 02:24:06.995', '2026-03-24 02:21:36.51', '2026-03-24 02:24:06.996');


--
-- Data for Name: automation_logs; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.automation_logs VALUES ('0be9c2b7-4348-465a-a425-c68f5743f68b', 'a3000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', false, '[{"data": {"title": "客戶諮詢", "caseId": "5afb66c6-ffcd-46d0-9eba-80e136147bf1"}, "action": "create_case", "success": true}, {"error": "Cannot auto-assign: no caseId in params or context", "action": "auto_assign", "success": false}]', 'auto_assign: Cannot auto-assign: no caseId in params or context', '2026-03-24 01:39:53.355');
INSERT INTO public.automation_logs VALUES ('176a13fd-e3aa-4ea0-822b-d4d0772e1bae', 'a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "自動開案：客戶提報故障", "caseId": "25b69ecf-4628-48fc-9131-c534a6c0de20"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"data": {"messageId": "47154929-34ae-4285-9d64-eff3bb534365"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 01:51:35.176');
INSERT INTO public.automation_logs VALUES ('2f818064-234a-41b0-ad8a-302a78f88ec1', 'a3000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "客訴處理", "caseId": "f74a3fe3-d0e6-4c75-83e3-7962ca0ad71b"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"action": "notify_supervisor", "success": true}, {"data": {"messageId": "c25a8e2d-6b13-45d4-b5ca-1beda35f8719"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 01:51:35.375');
INSERT INTO public.automation_logs VALUES ('d0e1cd10-aed5-4ffd-8262-e453e5a2ff77', 'a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "自動開案：客戶提報故障", "caseId": "530f6635-526e-49aa-bfd5-327a3b907cde"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"data": {"messageId": "f3531e82-9e8d-404b-91d0-27624cd926c2"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 02:20:59.402');
INSERT INTO public.automation_logs VALUES ('bd1c6065-9db6-4869-93a6-5e60cbe0cd66', 'a3000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "客訴處理", "caseId": "3a42d9f3-8b85-412a-bc7a-ea4db2b5d9fa"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"action": "notify_supervisor", "success": true}, {"data": {"messageId": "4d6e66ed-3a93-4fab-923b-fb8cdf1bf030"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 02:20:59.659');
INSERT INTO public.automation_logs VALUES ('6af129a9-70ba-4c92-a823-c54afa21cf72', 'a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "自動開案：客戶提報故障", "caseId": "464db9a6-1cd7-4147-872d-697998ed053e"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"data": {"messageId": "b4f677d3-c8bd-4a6f-88b9-3921c72cabb7"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 02:21:10.891');
INSERT INTO public.automation_logs VALUES ('87e57412-405c-4840-b890-ccd9bf754692', 'a3000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"title": "客訴處理", "caseId": "9b5ef388-ea50-4864-90d5-35353ff52856"}, "action": "create_case", "success": true}, {"data": {"tagId": "a69bf74f-01fc-4ebb-83f9-c37fe350ec16", "tagName": "客訴"}, "action": "add_tag", "success": true}, {"action": "notify_supervisor", "success": true}, {"data": {"messageId": "fb4d1762-5b56-46bb-869a-19ad0295beaf"}, "action": "send_message", "success": true}]', NULL, '2026-03-24 02:21:11.115');
INSERT INTO public.automation_logs VALUES ('954179d9-65a7-4222-a841-7346bc80dbc8', 'b8b9de41-aafa-4965-8689-4f33a7529ebf', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"messageId": "ad9231f7-8556-4ebc-8b15-a8a1b0fc270b", "replyText": "您好，您可以告訴我是哪一款冰箱以及您在幾年前購買的，這樣我可以提供更詳細的信息給您。還有其他需要幫忙的嗎？"}, "action": "llm_reply", "success": true}]', NULL, '2026-03-24 02:22:13.722');
INSERT INTO public.automation_logs VALUES ('b3fdb18f-5bbd-475f-a459-246d89de5ac3', 'b8b9de41-aafa-4965-8689-4f33a7529ebf', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"messageId": "7b96ef70-de7a-4183-8e42-25459bbe81de", "replyText": "您好，冰箱不冷的話請檢查門封是否鬆動或有損壞，並確保溫度設定正確。如果問題持續，建議聯繫服務中心進行維修。還有其他需要幫助的嗎？"}, "action": "llm_reply", "success": true}]', NULL, '2026-03-24 02:22:55.818');
INSERT INTO public.automation_logs VALUES ('a7ecca50-1dd1-475e-a3d7-8b4793c117dd', 'b8b9de41-aafa-4965-8689-4f33a7529ebf', 'a0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', true, '[{"data": {"messageId": "bb2d8f85-f3b9-43c1-89bd-c2f4a1b50e69", "replyText": "您好，洗衣機常見問題包括水壓不足、排水不暢等，您可以先檢查相關設置和管道是否正常。如果問題依然存在，建議聯繫服務中心進行檢查和維修。還有其他需要幫助的嗎？"}, "action": "llm_reply", "success": true}]', NULL, '2026-03-24 02:24:06.989');


--
-- Data for Name: campaigns; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.campaigns VALUES ('ec000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '春季家電節', '春季促銷活動，全品項最低 7 折起，指定機型加贈延保一年', 'active', '2026-03-10 01:09:23.129', '2026-04-23 01:09:23.129', '{"replied": 32, "delivered": 115, "totalSent": 120, "casesOpened": 5}', 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.853', '2026-03-24 01:09:23.853');
INSERT INTO public.campaigns VALUES ('ec000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '新品上市通知', '全新智慧家電系列即將上市，搶先通知忠實客戶', 'draft', NULL, NULL, '{}', 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.854', '2026-03-24 01:09:23.854');


--
-- Data for Name: segments; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.segments VALUES ('eb000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'VIP 客戶', '標記為 VIP 的重要客戶', '{"logic": "AND", "conditions": [{"field": "tag", "value": "VIP", "operator": "equals"}]}', 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.851', '2026-03-24 01:09:23.851');
INSERT INTO public.segments VALUES ('eb000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '冰箱客戶', '購買過冰箱產品的客戶', '{"logic": "AND", "conditions": [{"field": "tag", "value": "冰箱客戶", "operator": "equals"}]}', 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.852', '2026-03-24 01:09:23.852');
INSERT INTO public.segments VALUES ('eb000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '新用戶(近30天)', '近 30 天內建立的客戶', '{"logic": "AND", "conditions": [{"field": "createdAfter", "value": "30d", "operator": "gte"}]}', 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.853', '2026-03-24 01:09:23.853');


--
-- Data for Name: broadcasts; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.broadcasts VALUES ('ed000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000001', 'eb000000-0000-0000-0000-000000000001', 'da000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001', 'VIP 專屬優惠通知', 'completed', 'segment', '{}', NULL, '2026-03-17 01:09:23.129', 50, 48, 2, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.855', '2026-03-24 01:09:23.855');
INSERT INTO public.broadcasts VALUES ('ed000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000001', NULL, 'da000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001', '全品項促銷提醒', 'scheduled', 'all', '{}', '2026-03-26 01:09:23.129', NULL, 0, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.856', '2026-03-24 01:09:23.856');
INSERT INTO public.broadcasts VALUES ('ed000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'ec000000-0000-0000-0000-000000000002', 'eb000000-0000-0000-0000-000000000002', 'da000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', '新品預告', 'draft', 'segment', '{}', NULL, NULL, 0, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.857', '2026-03-24 01:09:23.857');


--
-- Data for Name: broadcast_recipients; Type: TABLE DATA; Schema: public; Owner: crm
--



--
-- Data for Name: contacts; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.contacts VALUES ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '王小美', NULL, '0912345678', 'wang@example.com', 'zh-TW', false, '2026-03-24 01:09:23.688', '2026-03-24 01:09:23.688', false, NULL);
INSERT INTO public.contacts VALUES ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '張大明', NULL, '0923456789', NULL, 'zh-TW', false, '2026-03-24 01:09:23.69', '2026-03-24 01:09:23.69', false, NULL);
INSERT INTO public.contacts VALUES ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '陳小芳', NULL, NULL, 'chen@example.com', 'zh-TW', false, '2026-03-24 01:09:23.691', '2026-03-24 01:09:23.691', false, NULL);
INSERT INTO public.contacts VALUES ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '李志豪', NULL, '0934567890', NULL, 'zh-TW', false, '2026-03-24 01:09:23.692', '2026-03-24 01:09:23.692', false, NULL);
INSERT INTO public.contacts VALUES ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '黃佳豪', NULL, NULL, 'huang@example.com', 'zh-TW', false, '2026-03-24 01:09:23.693', '2026-03-24 01:09:23.693', false, NULL);
INSERT INTO public.contacts VALUES ('2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'a0000000-0000-0000-0000-000000000001', 'Daniel', 'https://sprofile.line-scdn.net/0hSIpDhFhdDGZdPRJRAQNyWC1tDwx-TFV0IVJFVG1vAQUyDBgwIg9KU2xtUlE3XkgzcVpGAGE6WlF_DxJxCRlHfnRPNQEiSQNVEyAkZiBhLSQLeDxmISQ_X2taNlM9DTZJKF0FYmA5EVE7bgxHM1kQUA16WwNkbTFlKGpgMFgPYuUyP3szcFpGB200Wl_l', NULL, NULL, 'zh-TW', false, '2026-03-24 01:39:53.253', '2026-03-24 01:39:53.253', false, NULL);


--
-- Data for Name: cases; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.cases VALUES ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', NULL, '洗衣機噪音問題', '客戶詢問洗衣機保固狀態，產品有噪音問題待處理。', 'OPEN', 'MEDIUM', '維修', NULL, NULL, '中優先', NULL, NULL, NULL, NULL, '2026-03-24 01:09:23.748', '2026-03-24 01:09:23.748', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('a1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', NULL, '保固查詢', '客戶查詢大金冷氣保固資訊並預約維修，已安排維修時段。', 'RESOLVED', 'LOW', '查詢', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', '低優先', NULL, '2026-03-23 01:09:23.129', NULL, NULL, '2026-03-24 01:09:23.749', '2026-03-24 01:09:23.749', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('5afb66c6-ffcd-46d0-9eba-80e136147bf1', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '客戶諮詢', NULL, 'OPEN', 'MEDIUM', '諮詢', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 01:39:53.353', '2026-03-24 01:39:53.353', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('25b69ecf-4628-48fc-9131-c534a6c0de20', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '自動開案：客戶提報故障', NULL, 'OPEN', 'HIGH', '維修', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 01:51:34.958', '2026-03-24 01:51:34.958', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('f74a3fe3-d0e6-4c75-83e3-7962ca0ad71b', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '客訴處理', NULL, 'OPEN', 'HIGH', '客訴', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 01:51:35.183', '2026-03-24 01:51:35.183', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('530f6635-526e-49aa-bfd5-327a3b907cde', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '自動開案：客戶提報故障', NULL, 'OPEN', 'HIGH', '維修', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 02:20:59.132', '2026-03-24 02:20:59.132', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('3a42d9f3-8b85-412a-bc7a-ea4db2b5d9fa', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '客訴處理', NULL, 'OPEN', 'HIGH', '客訴', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 02:20:59.416', '2026-03-24 02:20:59.416', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('464db9a6-1cd7-4147-872d-697998ed053e', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '自動開案：客戶提報故障', NULL, 'OPEN', 'HIGH', '維修', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 02:21:10.652', '2026-03-24 02:21:10.652', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('9b5ef388-ea50-4864-90d5-35353ff52856', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', '3525deb9-e07c-42be-a107-8ec7783019fe', '客訴處理', NULL, 'OPEN', 'HIGH', '客訴', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-03-24 02:21:10.9', '2026-03-24 02:21:10.9', NULL, NULL, NULL, NULL);
INSERT INTO public.cases VALUES ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', NULL, '冰箱不製冷維修', '客戶反映 Samsung RF90K 冰箱不製冷，需安排維修技師到府檢修。產品尚在三年保固期內。', 'IN_PROGRESS', 'URGENT', '維修', 'b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', '高優先', '2026-03-24 05:09:23.129', NULL, NULL, NULL, '2026-03-24 01:09:23.747', '2026-03-24 05:10:22.542', NULL, NULL, NULL, NULL);


--
-- Data for Name: case_events; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'system', NULL, 'created', '{"title": "冰箱不製冷維修", "priority": "HIGH"}', '2026-03-23 23:14:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'agent', 'b0000000-0000-0000-0000-000000000002', 'assigned', '{"assigneeId": "b0000000-0000-0000-0000-000000000003", "assigneeName": "王小華"}', '2026-03-23 23:15:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'agent', 'b0000000-0000-0000-0000-000000000003', 'status_changed', '{"to": "IN_PROGRESS", "from": "OPEN"}', '2026-03-23 23:16:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'system', NULL, 'created', '{"title": "洗衣機噪音問題", "priority": "MEDIUM"}', '2026-03-24 00:41:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', 'system', NULL, 'created', '{"title": "保固查詢", "priority": "LOW"}', '2026-03-22 01:09:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003', 'agent', 'b0000000-0000-0000-0000-000000000002', 'assigned', '{"assigneeId": "b0000000-0000-0000-0000-000000000003", "assigneeName": "王小華"}', '2026-03-22 01:11:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000003', 'agent', 'b0000000-0000-0000-0000-000000000003', 'status_changed', '{"to": "IN_PROGRESS", "from": "OPEN"}', '2026-03-22 01:12:23.129');
INSERT INTO public.case_events VALUES ('ce000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000003', 'agent', 'b0000000-0000-0000-0000-000000000003', 'status_changed', '{"to": "RESOLVED", "from": "IN_PROGRESS"}', '2026-03-23 01:09:23.129');
INSERT INTO public.case_events VALUES ('7ccd6f83-34ff-4013-bb23-b3674b3f3c58', 'a1000000-0000-0000-0000-000000000001', 'system', NULL, 'first_response_breached', '{"type": "first_response", "deadline": "2026-03-24T02:09:23.747Z", "createdAt": "2026-03-24T01:09:23.747Z", "firstResponseMinutes": 60}', '2026-03-24 02:09:51.793');
INSERT INTO public.case_events VALUES ('457cd254-b371-4ad3-8e3b-f2b1827fcff5', 'a1000000-0000-0000-0000-000000000001', 'system', NULL, 'sla_warning', '{"slaDueAt": "2026-03-24T05:09:23.129Z", "warningBeforeMinutes": 15}', '2026-03-24 04:55:22.508');
INSERT INTO public.case_events VALUES ('52781b24-b511-44df-a8f7-cd7715d1cbaa', 'a1000000-0000-0000-0000-000000000001', 'system', NULL, 'sla_breached', '{"type": "resolution", "slaDueAt": "2026-03-24T05:09:23.129Z", "newPriority": "URGENT", "previousPriority": "HIGH"}', '2026-03-24 05:10:22.558');
INSERT INTO public.case_events VALUES ('4e0c81c0-e0cb-400e-bcd3-ae69bd1b23ce', 'a1000000-0000-0000-0000-000000000002', 'system', NULL, 'first_response_breached', '{"type": "first_response", "deadline": "2026-03-24T05:09:23.748Z", "createdAt": "2026-03-24T01:09:23.748Z", "firstResponseMinutes": 240}', '2026-03-24 05:10:22.584');
INSERT INTO public.case_events VALUES ('1a436e14-279b-460b-ad1f-1df89b1e4077', 'a1000000-0000-0000-0000-000000000001', 'system', NULL, 'first_response_breached', '{"type": "first_response", "deadline": "2026-03-24T02:09:23.747Z", "createdAt": "2026-03-24T01:09:23.747Z", "firstResponseMinutes": 60}', '2026-03-25 02:10:16.612');


--
-- Data for Name: case_notes; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.case_notes VALUES ('cf000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', '客戶冰箱型號 RF90K，保固期內，需安排維修技師', true, '2026-03-24 01:09:23.759');


--
-- Data for Name: channels; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.channels VALUES ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'FB', 'Demo Facebook', true, '{"mock":"true"}', '{"botConfig": {"botMode": "keyword_then_llm", "maxBotReplies": 5, "handoffMessage": "稍等，正在為您轉接客服人員，請稍候。", "handoffKeywords": ["真人", "人工", "客服", "轉接"], "offlineGreeting": "感謝您的來訊！目前非營業時間，我們將在營業時間盡速回覆您。"}}', NULL, NULL, '2026-03-24 01:09:23.686', '2026-03-24 01:09:23.686');
INSERT INTO public.channels VALUES ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'WEBCHAT', '網站客服', true, '{"mock":"true"}', '{"botConfig": {"botMode": "keyword_then_llm", "maxBotReplies": 5, "handoffMessage": "稍等，正在為您轉接客服人員，請稍候。", "handoffKeywords": ["真人", "人工", "客服", "轉接"], "offlineGreeting": "感謝您的來訊！目前非營業時間，我們將在營業時間盡速回覆您。"}}', NULL, NULL, '2026-03-24 01:09:23.687', '2026-03-24 01:09:23.687');
INSERT INTO public.channels VALUES ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'LINE', '小美', true, '42373e2af5a6dd19d885577c358076af:3587ced4a056ce6272023080812766f7:8a2b03d0634402e2bf35d62febb1afddf2ac030fecc7b9b792fb3dfe1f8961b27572aaf7c46626f5e908b12b3c699b793ae0be9b74a8b96f06e66087ea3594c48483fde21eb31fcf3ccdc060499958e5f37888b7714bff3f879508526bd878dd672bd7a6ff8c628c9934747af54e3a913dc53d66ce30c1fd41587e66a405f526f0e746efc8302f3784ba41462264d46d65e82ca09a8f210452d68fca4bca21ea07fa41f203a4e0c2baff8b1fd52c8597a7949baef4ef17706919b16b7658229b9f29e758ef8980a7f5df980dbc2b9182ccc32c8c373ea2c5392ecc07818c85277a0a98ea663864554046df5849d30c5754560f494956cdbc', '{"botConfig": {"botMode": "keyword_then_llm", "maxBotReplies": 5, "handoffMessage": "稍等，正在為您轉接客服人員，請稍候。", "handoffKeywords": ["真人", "人工", "客服", "轉接"], "offlineGreeting": "感謝您的來訊！目前非營業時間，我們將在營業時間盡速回覆您。"}}', NULL, '2026-03-24 01:37:50.656', '2026-03-24 01:09:23.683', '2026-03-24 01:37:50.656');


--
-- Data for Name: channel_identities; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'line-user-wang', '王小美', NULL, '2026-03-24 01:09:23.694');
INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'FB', 'fb-user-wang', '王小美', NULL, '2026-03-24 01:09:23.696');
INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'FB', 'fb-user-zhang', '張大明', NULL, '2026-03-24 01:09:23.697');
INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'WEBCHAT', 'webchat-user-chen', '陳小芳', NULL, '2026-03-24 01:09:23.699');
INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'line-user-li', '李志豪', NULL, '2026-03-24 01:09:23.7');
INSERT INTO public.channel_identities VALUES ('ca000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'FB', 'fb-user-huang', '黃佳豪', NULL, '2026-03-24 01:09:23.701');
INSERT INTO public.channel_identities VALUES ('cedeabd9-e768-4074-8e6b-813e60ae9560', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'U5df95f4c7d48b75a7f7fb1542b6863e2', 'Daniel', 'https://sprofile.line-scdn.net/0hSIpDhFhdDGZdPRJRAQNyWC1tDwx-TFV0IVJFVG1vAQUyDBgwIg9KU2xtUlE3XkgzcVpGAGE6WlF_DxJxCRlHfnRPNQEiSQNVEyAkZiBhLSQLeDxmISQ_X2taNlM9DTZJKF0FYmA5EVE7bgxHM1kQUA16WwNkbTFlKGpgMFgPYuUyP3szcFpGB200Wl_l', '2026-03-24 01:39:53.259');


--
-- Data for Name: short_links; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.short_links VALUES ('de000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'promo1', 'https://example.com/promo', '春季促銷活動', 'line', 'social', 'spring2024', NULL, NULL, 'aa000000-0000-0000-0000-000000000002', true, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.82', '2026-03-24 01:09:23.82');
INSERT INTO public.short_links VALUES ('de000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'event1', 'https://example.com/event', '粉絲見面會報名', NULL, NULL, NULL, NULL, NULL, NULL, true, NULL, 15, 10, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.821', '2026-03-24 01:09:23.821');
INSERT INTO public.short_links VALUES ('de000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'old1', 'https://example.com/old', '已過期活動', NULL, NULL, NULL, NULL, NULL, NULL, true, '2026-02-22 01:09:23.129', 3, 2, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.822', '2026-03-24 01:09:23.822');


--
-- Data for Name: click_logs; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000001', 'de000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', '192.168.1.100', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://line.me', NULL, '2026-03-23 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000002', 'de000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002', '192.168.1.101', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://facebook.com', NULL, '2026-03-23 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000003', 'de000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', '192.168.1.102', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', NULL, NULL, '2026-03-23 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000004', 'de000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000004', '192.168.1.103', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://line.me', NULL, '2026-03-22 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000005', 'de000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000005', '192.168.1.104', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://facebook.com', NULL, '2026-03-22 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000006', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.105', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', NULL, NULL, '2026-03-22 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000007', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.106', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://line.me', NULL, '2026-03-21 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000008', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.107', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://facebook.com', NULL, '2026-03-21 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000009', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.108', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', NULL, NULL, '2026-03-21 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000010', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.109', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://line.me', NULL, '2026-03-20 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000011', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.110', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://facebook.com', NULL, '2026-03-20 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000012', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.111', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', NULL, NULL, '2026-03-20 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000013', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.112', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://line.me', NULL, '2026-03-19 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000014', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.113', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', 'https://facebook.com', NULL, '2026-03-19 01:09:23.129');
INSERT INTO public.click_logs VALUES ('df000000-0000-0000-0000-000000000015', 'de000000-0000-0000-0000-000000000002', NULL, '192.168.1.114', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0)', NULL, NULL, '2026-03-19 01:09:23.129');


--
-- Data for Name: contact_attributes; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.contact_attributes VALUES ('cc000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'brand', 'Samsung', 'string');
INSERT INTO public.contact_attributes VALUES ('cc000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'model', 'RF90K', 'string');
INSERT INTO public.contact_attributes VALUES ('cc000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'purchaseDate', '2023-03-01', 'date');


--
-- Data for Name: contact_relations; Type: TABLE DATA; Schema: public; Owner: crm
--



--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'VIP', '#ef4444', 'MANUAL', 'CONTACT', 'VIP 重要客戶', '2026-03-24 01:09:23.703');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '冰箱客戶', '#3b82f6', 'AUTO', 'CONTACT', '購買過冰箱產品的客戶', '2026-03-24 01:09:23.705');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '保固中', '#22c55e', 'SYSTEM', 'CONTACT', '產品仍在保固期內', '2026-03-24 01:09:23.707');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '新用戶', '#a855f7', 'AUTO', 'CONTACT', '近 30 天內建立的客戶', '2026-03-24 01:09:23.707');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '洗衣機客戶', '#f97316', 'MANUAL', 'CONTACT', '購買過洗衣機產品的客戶', '2026-03-24 01:09:23.708');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'LINE好友', '#06b6d4', 'CHANNEL', 'CONTACT', '透過 LINE 管道聯繫的客戶', '2026-03-24 01:09:23.709');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '客訴', '#dc2626', 'MANUAL', 'CASE', '客戶投訴案件', '2026-03-24 01:09:23.709');
INSERT INTO public.tags VALUES ('aa000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '緊急', '#b91c1c', 'SYSTEM', 'CASE', '需要緊急處理的案件', '2026-03-24 01:09:23.71');
INSERT INTO public.tags VALUES ('a69bf74f-01fc-4ebb-83f9-c37fe350ec16', 'a0000000-0000-0000-0000-000000000001', '客訴', '#6366f1', 'AUTO', 'CONTACT', 'Auto-created by automation rule', '2026-03-24 01:51:34.961');


--
-- Data for Name: contact_tags; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000001', 'agent', 'b0000000-0000-0000-0000-000000000003', '2026-03-24 01:09:23.711', NULL);
INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000002', 'system', NULL, '2026-03-24 01:09:23.713', NULL);
INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000001', 'aa000000-0000-0000-0000-000000000003', 'system', NULL, '2026-03-24 01:09:23.715', NULL);
INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000002', 'aa000000-0000-0000-0000-000000000005', 'agent', 'b0000000-0000-0000-0000-000000000003', '2026-03-24 01:09:23.716', NULL);
INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000005', 'e0000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000006', 'system', NULL, '2026-03-24 01:09:23.718', NULL);
INSERT INTO public.contact_tags VALUES ('cb000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000004', 'aa000000-0000-0000-0000-000000000004', 'system', NULL, '2026-03-24 01:09:23.719', NULL);
INSERT INTO public.contact_tags VALUES ('60b71676-a1ee-465f-895f-24cf8f10eb51', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'a69bf74f-01fc-4ebb-83f9-c37fe350ec16', 'automation', NULL, '2026-03-24 01:51:34.963', NULL);


--
-- Data for Name: conversations; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.conversations VALUES ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'FB', 'AGENT_HANDLED', NULL, NULL, 3, '2026-03-24 00:39:23.129', '2026-03-24 01:09:23.727', '2026-03-24 01:09:23.727', 0, NULL);
INSERT INTO public.conversations VALUES ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'WEBCHAT', 'BOT_HANDLED', NULL, NULL, 2, '2026-03-24 00:14:23.129', '2026-03-24 01:09:23.728', '2026-03-24 01:09:23.728', 0, NULL);
INSERT INTO public.conversations VALUES ('f0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'FB', 'BOT_HANDLED', NULL, NULL, 3, '2026-03-24 00:59:23.129', '2026-03-24 01:09:23.73', '2026-03-24 01:09:23.73', 0, NULL);
INSERT INTO public.conversations VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'AGENT_HANDLED', 'b0000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 0, '2026-03-23 23:19:23.129', '2026-03-24 01:09:23.726', '2026-03-24 01:09:23.75', 0, NULL);
INSERT INTO public.conversations VALUES ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'CLOSED', NULL, 'a1000000-0000-0000-0000-000000000003', 0, '2026-03-22 01:09:23.129', '2026-03-24 01:09:23.729', '2026-03-24 01:09:23.751', 0, NULL);
INSERT INTO public.conversations VALUES ('3525deb9-e07c-42be-a107-8ec7783019fe', 'a0000000-0000-0000-0000-000000000001', '2031ff43-5dd9-47a9-a5ad-a6ff59ade6e2', 'd0000000-0000-0000-0000-000000000001', 'LINE', 'BOT_HANDLED', NULL, NULL, 13, '2026-03-24 02:24:04.584', '2026-03-24 01:39:53.267', '2026-03-24 02:24:04.585', 3, NULL);


--
-- Data for Name: daily_stats; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.daily_stats VALUES ('90f2e5ac-f7e8-4c15-95a8-73ca90239f07', 'a0000000-0000-0000-0000-000000000001', '2026-03-22', 'overview', '', '{"csatAvg": null, "newCases": 0, "openCases": 5, "resolvedCases": 1, "totalMessages": 0, "inboundMessages": 0, "csatPositiveRate": null, "outboundMessages": 0, "slaAchievementRate": null, "avgResolutionMinutes": null, "avgFirstResponseMinutes": null}', '2026-03-24 01:10:57.395');
INSERT INTO public.daily_stats VALUES ('318f1c12-a314-465b-917f-c701b51cea09', 'a0000000-0000-0000-0000-000000000001', '2026-03-22', 'case', '', '{"trend": [], "slaViolations": [], "escalationRate": 0, "statusDistribution": [], "categoryDistribution": [], "priorityDistribution": []}', '2026-03-24 01:10:57.407');
INSERT INTO public.daily_stats VALUES ('16d61fad-72b9-4ac0-afa6-187b714d5c24', 'a0000000-0000-0000-0000-000000000001', '2026-03-23', 'overview', '', '{"csatAvg": null, "newCases": 10, "openCases": 9, "resolvedCases": 0, "totalMessages": 38, "inboundMessages": 24, "csatPositiveRate": null, "outboundMessages": 14, "slaAchievementRate": null, "avgResolutionMinutes": -1440, "avgFirstResponseMinutes": null}', '2026-03-24 18:00:00.736');
INSERT INTO public.daily_stats VALUES ('48e8fecd-60a1-43d5-8456-7cb46ee46d55', 'a0000000-0000-0000-0000-000000000001', '2026-03-23', 'case', '', '{"trend": [{"date": "2026-03-24", "closed": 1, "opened": 10}], "slaViolations": [{"id": "a1000000-0000-0000-0000-000000000001", "title": "冰箱不製冷維修", "status": "IN_PROGRESS", "teamId": "c0000000-0000-0000-0000-000000000001", "contact": {"id": "e0000000-0000-0000-0000-000000000001", "displayName": "王小美"}, "assignee": {"id": "b0000000-0000-0000-0000-000000000003", "name": "王小華"}, "category": "維修", "closedAt": null, "priority": "URGENT", "slaDueAt": "2026-03-24T05:09:23.129Z", "tenantId": "a0000000-0000-0000-0000-000000000001", "channelId": "d0000000-0000-0000-0000-000000000001", "contactId": "e0000000-0000-0000-0000-000000000001", "createdAt": "2026-03-24T01:09:23.747Z", "csatScore": null, "slaPolicy": "高優先", "updatedAt": "2026-03-24T05:10:22.542Z", "assigneeId": "b0000000-0000-0000-0000-000000000003", "csatSentAt": null, "resolvedAt": null, "csatComment": null, "description": "客戶反映 Samsung RF90K 冰箱不製冷，需安排維修技師到府檢修。產品尚在三年保固期內。", "conversationId": null, "csatRespondedAt": null, "firstResponseAt": null}], "escalationRate": 0, "statusDistribution": [{"name": "OPEN", "value": 8}, {"name": "IN_PROGRESS", "value": 1}, {"name": "RESOLVED", "value": 1}], "categoryDistribution": [{"name": "維修", "value": 5}, {"name": "客訴", "value": 3}, {"name": "查詢", "value": 1}, {"name": "諮詢", "value": 1}], "priorityDistribution": [{"name": "LOW", "value": 1}, {"name": "MEDIUM", "value": 2}, {"name": "HIGH", "value": 6}, {"name": "URGENT", "value": 1}]}', '2026-03-24 18:00:00.771');


--
-- Data for Name: km_articles; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '產品保固政策說明', '# Open333 產品保固政策

## 標準保固期限
- **一般家電產品**（電視、微波爐、電鍋等）：自購買日起 **1 年**
- **冰箱壓縮機**：自購買日起 **3 年**
- **洗衣機馬達**：自購買日起 **5 年**
- **冷氣壓縮機**：自購買日起 **3 年**

## 保固範圍
1. 產品在正常使用下發生的故障
2. 原廠零件的材料或製造瑕疵
3. 保固期內免費到府維修服務（含零件及工資）

## 不在保固範圍
- 人為損壞、不當使用
- 自行拆裝或非原廠維修造成的損壞
- 天災（如雷擊、水災）造成的損壞
- 消耗品（如濾網、燈泡）

## 延長保固
可加購延長保固方案，最長延至 5 年。詳情請洽客服人員。', 'Open333 家電產品保固政策總覽，包含一般保固及延長保固說明。', '保固', '{保固,政策,售後}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.843', '2026-03-24 01:09:23.843');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '維修服務流程', '# 維修服務流程

## 報修方式
1. **LINE 官方帳號**：直接傳訊息描述問題
2. **客服電話**：0800-333-333（週一至週五 9:00-18:00）
3. **網站客服**：透過網站右下角客服對話窗

## 維修流程
1. **報修登記**：客服人員確認產品資訊、故障描述，建立服務單
2. **技師派工**：根據地區與產品類型，指派專業技師
3. **預約到府**：技師主動致電客戶，安排到府維修時間
4. **到府維修**：技師攜帶工具與零件到府檢修
5. **維修回報**：維修完成後回報系統，客戶可查詢維修結果

## 維修時效
- **一般件**：報修後 **3 個工作天** 內到府
- **急件**：報修後 **24 小時** 內到府（保固內免加價）
- **偏遠地區**：可能需額外 1-2 個工作天

## 維修費用
- 保固期內：**免費**（含零件及工資）
- 保固期外：依實際零件及工資計費，維修前會先報價確認', '客戶報修到維修完成的完整流程說明。', '維修', '{維修,報修,流程}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.845', '2026-03-24 01:09:23.845');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '退換貨規定', '# 退換貨規定

## 7 天鑑賞期（線上購買適用）
- 自收到商品日起 **7 天內**，可申請無條件退貨
- 商品須保持全新未使用狀態
- 原廠包裝、配件、贈品須齊全
- 退貨運費由公司負擔

## 瑕疵品換新
- 收到商品即發現瑕疵，可 **免費換新**
- 請在收貨後 **3 天內** 聯繫客服
- 需提供瑕疵照片或影片佐證
- 換新品於 **5 個工作天** 內寄出

## 退款方式
- 信用卡付款：退回原信用卡，約 **7-14 個工作天**
- 銀行轉帳：退回指定帳戶，約 **5 個工作天**
- 貨到付款：退回指定帳戶，約 **5 個工作天**

## 不接受退換貨
- 超過 7 天鑑賞期
- 商品已安裝使用（非瑕疵）
- 客製化商品
- 消耗品（如濾網、濾芯）已拆封', '產品退換貨政策與流程。', '售後', '{退貨,換貨,退款,售後}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.846', '2026-03-24 01:09:23.846');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '冰箱常見問題排除', '# 冰箱常見問題排除

## 冰箱不製冷
1. 檢查電源插頭是否鬆脫
2. 確認溫度設定是否正確（建議冷藏 3-5°C，冷凍 -18°C）
3. 檢查門封條是否密合（可用紙張測試）
4. 清潔冷凝器散熱網（冰箱背面或底部）
5. 確認食物沒有擋住出風口
6. 若以上皆正常，可能是壓縮機或冷媒問題，請聯繫客服報修

## 冰箱結霜嚴重
1. 避免頻繁開關門
2. 食物放涼後再放入冰箱
3. 檢查門封條是否老化
4. 定期除霜（手動除霜機型）
5. 確認排水孔暢通

## 冰箱有異音
1. 壓縮機運轉聲：正常現象
2. 流水聲：冷媒循環聲，屬正常
3. 喀喀聲：溫度變化造成的熱脹冷縮，屬正常
4. 持續嗡嗡聲：檢查冰箱是否水平放置
5. 異常撞擊聲：可能是壓縮機異常，請聯繫客服', '冰箱常見問題自行檢查步驟。', '產品FAQ', '{冰箱,FAQ,故障排除}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.846', '2026-03-24 01:09:23.846');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '洗衣機常見問題排除', '# 洗衣機常見問題排除

## 洗衣機不排水
1. 檢查排水管是否彎折或堵塞
2. 清潔排水濾網（通常在機體正面下方）
3. 確認排水管高度不超過 100 公分
4. 檢查排水管是否正確接入排水口
5. 若仍無法排水，可能是排水馬達故障，請聯繫客服

## 洗衣機有異響
1. 確認衣物分佈均勻，避免單邊過重
2. 檢查是否有硬物（如硬幣）卡在滾筒
3. 確認洗衣機放置水平
4. 運輸螺栓是否已移除（新機安裝時）
5. 持續異響請聯繫客服檢修

## 常見錯誤碼
- **E1**：進水異常 → 檢查水龍頭是否開啟、進水管是否折到
- **E2**：排水異常 → 檢查排水管是否堵塞
- **E3**：門蓋未關好 → 重新關閉門蓋
- **E4**：衣物不平衡 → 重新分配衣物後再啟動
- **E5**：水溫異常 → 檢查熱水器設定

## 日常保養建議
- 每月清潔一次洗衣槽（可用專用清潔劑）
- 洗完衣物後打開門蓋通風
- 定期清潔濾網
- 避免超量放入衣物', '洗衣機常見問題與錯誤碼處理。', '產品FAQ', '{洗衣機,FAQ,故障排除}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.847', '2026-03-24 01:09:23.847');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '線上購物流程說明', '# 線上購物流程說明

## 購物步驟
1. **選購商品**：瀏覽官網商品頁面，選擇規格與數量
2. **加入購物車**：確認商品資訊後加入購物車
3. **結帳下單**：填寫收件資訊，選擇配送方式
4. **線上付款**：支援信用卡、ATM 轉帳、貨到付款
5. **訂單確認**：系統寄送訂單確認信至您的信箱
6. **商品配送**：物流配送到府，可追蹤配送進度
7. **安裝服務**：大型家電提供免費安裝服務

## 配送說明
- **一般商品**：下單後 **3-5 個工作天** 送達
- **大型家電**：下單後 **5-7 個工作天** 配送安裝
- **偏遠地區**：可能需額外 2-3 個工作天
- **免運門檻**：單筆消費滿 **NT$ 1,000** 免運費

## 安裝服務
- 冰箱、洗衣機、冷氣等大型家電提供 **免費基本安裝**
- 安裝師傅會與您約定安裝時間
- 舊機回收服務：**免費** 回收舊家電', '從選購到安裝的完整線上購物流程。', '購物', '{購物,下單,付款,配送}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.848', '2026-03-24 01:09:23.848');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '會員積分規則', '# 會員積分規則

## 積分累積
- 消費 **1 元 = 1 點**
- 線上購物與門市消費皆可累積
- 參加官方活動可額外獲得積分
- 填寫問卷、投票等互動也可獲得積分

## 積分兌換
- **500 點**：可折抵 NT$ 50 消費金
- **1,000 點**：可兌換精選小家電配件
- **3,000 點**：可兌換延長保固 1 年
- **5,000 點**：可折抵 NT$ 600 消費金（加碼回饋）

## 積分有效期
- 積分自獲得日起 **2 年** 內有效
- 過期積分將自動失效，不另行通知
- 建議定期查看積分餘額與到期日

## VIP 會員
- 年度消費累計達 **NT$ 50,000** 自動升級 VIP
- VIP 享有 **1.5 倍** 積分加成
- VIP 專屬客服優先服務
- VIP 生日當月 **雙倍** 積分', '會員積分累積與兌換規則說明。', '會員', '{會員,積分,點數,兌換}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.849', '2026-03-24 01:09:23.849');
INSERT INTO public.km_articles VALUES ('ea000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '節能補助申請指南', '# 節能補助申請指南

## 適用產品
- **冰箱**：能效等級 1 級或 2 級
- **冷氣**：能效等級 1 級或 2 級
- **除濕機**：能效等級 1 級或 2 級

## 補助金額
- 1 級能效：每台最高補助 **NT$ 3,000**
- 2 級能效：每台最高補助 **NT$ 1,000**
- 每戶每年最多申請 **3 台**

## 申請流程
1. 購買符合資格的節能家電
2. 保留購買發票正本
3. 準備舊機回收證明（汰舊換新可加碼 NT$ 2,000）
4. 至政府節能補助網站線上申請
5. 上傳所需文件（發票、身分證、存摺封面）
6. 審核通過後，補助款項匯入指定帳戶

## 注意事項
- 須在購買日起 **60 天內** 完成申請
- Open333 提供購買證明協助
- 門市人員可協助線上申請
- 補助名額有限，建議及早申請', '政府節能家電補助申請流程說明。', '優惠', '{節能,補助,政府,優惠}', 'PUBLISHED', NULL, NULL, 0, 0, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.85', '2026-03-24 01:09:23.85');


--
-- Data for Name: message_templates; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000001', NULL, '歡迎訊息', '新客戶首次聯繫時的歡迎訊息', '一般', 'universal', 'text', '{"text": "{{contact.name}} 您好！歡迎聯繫我們，請問有什麼可以為您服務的嗎？"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.765', '2026-03-24 01:09:23.765');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000002', NULL, '等候通知', '客服忙線時的等候通知', '一般', 'universal', 'text', '{"text": "{{contact.name}} 您好，目前客服人員忙線中，我們將盡快為您服務，請稍候。"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.766', '2026-03-24 01:09:23.766');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000003', NULL, '滿意度調查', '服務結束後的滿意度調查', '一般', 'universal', 'text', '{"text": "{{contact.name}} 您好，感謝您使用我們的服務！請問您對本次服務的滿意度如何？（1-5 分）"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.768', '2026-03-24 01:09:23.768');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000004', NULL, '案件建立通知', '案件建立後通知客戶', '服務類', 'universal', 'text', '{"text": "{{contact.name}} 您好，您的案件已建立。\n案件編號：{{case.id}}\n案件主題：{{case.title}}\n我們將盡快處理，感謝您的耐心等候。"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "case.id", "label": "案件編號", "required": false}, {"key": "case.title", "label": "案件主題", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.768', '2026-03-24 01:09:23.768');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000005', NULL, '案件狀態更新', '案件狀態變更時通知客戶', '服務類', 'universal', 'text', '{"text": "{{contact.name}} 您好，您的案件狀態已更新。\n案件編號：{{case.id}}\n目前狀態：{{case.status}}\n如有疑問，歡迎隨時聯繫我們。"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "case.id", "label": "案件編號", "required": false}, {"key": "case.status", "label": "案件狀態", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.769', '2026-03-24 01:09:23.769');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000006', NULL, '維修預約確認', '維修預約成功後的確認訊息', '服務類', 'universal', 'text', '{"text": "{{contact.name}} 您好，您的維修預約已確認。\n案件編號：{{case.id}}\n請於預約時間保持聯繫方式暢通，我們的技術人員將與您聯繫。"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "case.id", "label": "案件編號", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.77', '2026-03-24 01:09:23.77');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000007', NULL, '保固到期提醒', '產品保固即將到期的提醒', '行銷類', 'universal', 'text', '{"text": "{{contact.name}} 您好，您的產品保固即將到期。建議您考慮延長保固服務，享受更完整的售後保障。歡迎聯繫我們了解詳情！"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.771', '2026-03-24 01:09:23.771');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000008', NULL, '促銷活動通知', '促銷活動的行銷推播', '行銷類', 'universal', 'text', '{"text": "{{contact.name}} 您好！我們正在舉辦限時優惠活動，精選商品享有特別折扣。立即前往查看：{{storage.base_url}}/promo"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "storage.base_url", "label": "儲存網址", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.772', '2026-03-24 01:09:23.772');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000009', NULL, '服務選單', '提供快速選單讓客戶選擇服務項目', '互動類', 'universal', 'quick_reply', '{"text": "{{contact.name}} 您好！請選擇您需要的服務：", "quickReplies": [{"text": "我想了解產品", "label": "產品諮詢", "postbackData": "action=inquiry"}, {"text": "我需要維修服務", "label": "維修服務", "postbackData": "action=repair"}, {"text": "我要查詢訂單", "label": "訂單查詢", "postbackData": "action=order"}, {"text": "我要聯繫客服", "label": "聯繫客服", "postbackData": "action=agent"}]}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.773', '2026-03-24 01:09:23.773');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000a', NULL, '案件確認卡', '以 Flex Message 格式顯示案件確認資訊', '服務類', 'LINE', 'flex', '{"text": "案件確認：{{case.title}}", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "案件確認", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "contents": [{"size": "sm", "text": "案件編號：{{case.id}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "主題：{{case.title}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "優先級：{{case.priority}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "狀態：{{case.status}}", "type": "text", "color": "#555555"}]}]}, "type": "bubble"}}', '[{"key": "case.id", "label": "案件編號", "required": false}, {"key": "case.title", "label": "案件主題", "required": false}, {"key": "case.priority", "label": "優先級", "required": false}, {"key": "case.status", "label": "案件狀態", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.774', '2026-03-24 01:09:23.774');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000b', NULL, '產品規格卡', '以 Flex Message 格式顯示產品規格', '互動類', 'LINE', 'flex', '{"text": "產品規格資訊", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "產品規格", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "contents": [{"size": "sm", "text": "型號：{{attribute.model}}", "type": "text"}, {"size": "sm", "text": "規格：{{attribute.spec}}", "type": "text"}, {"size": "sm", "text": "價格：{{attribute.price}}", "type": "text"}]}]}, "type": "bubble"}}', '[{"key": "attribute.model", "label": "產品型號", "required": false, "defaultValue": "-"}, {"key": "attribute.spec", "label": "產品規格", "required": false, "defaultValue": "-"}, {"key": "attribute.price", "label": "產品價格", "required": false, "defaultValue": "-"}]', NULL, true, true, 0, '2026-03-24 01:09:23.775', '2026-03-24 01:09:23.775');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000c', NULL, '節慶問候', '節日問候訊息', '問候', 'universal', 'text', '{"text": "{{contact.name}} 您好！祝您佳節愉快！感謝您一直以來的支持與信賴，我們將持續為您提供最好的服務。"}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.776', '2026-03-24 01:09:23.776');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001e', NULL, '圖文選單替代卡', '以快速回覆模擬圖文選單功能', '互動類', 'universal', 'quick_reply', '{"text": "{{contact.name}} 您好！請選擇您需要的服務：", "quickReplies": [{"text": "我要查詢訂單", "label": "查詢訂單", "postbackData": "action=order_query"}, {"text": "我需要報修", "label": "報修服務", "postbackData": "action=repair"}, {"text": "我想了解產品", "label": "產品諮詢", "postbackData": "action=product"}, {"text": "轉接真人客服", "label": "聯繫客服", "postbackData": "action=handoff"}]}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}]', NULL, true, true, 0, '2026-03-24 01:09:23.8', '2026-03-24 01:09:23.8');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000d', NULL, '維修進度追蹤', '以 Flex 卡片顯示維修進度', '服務類', 'LINE', 'flex', '{"text": "維修進度：{{case.title}}", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "維修進度追蹤", "type": "text", "color": "#1DB446", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "案件：{{case.title}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "狀態：{{case.status}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "技師：{{attribute.technician}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "預計完工：{{attribute.eta}}", "type": "text", "color": "#555555"}]}]}, "type": "bubble"}}', '[{"key": "case.title", "label": "案件主題", "required": false}, {"key": "case.status", "label": "案件狀態", "required": false}, {"key": "attribute.technician", "label": "技師名稱", "required": false, "defaultValue": "待指派"}, {"key": "attribute.eta", "label": "預計完工", "required": false, "defaultValue": "待確認"}]', NULL, true, true, 0, '2026-03-24 01:09:23.777', '2026-03-24 01:09:23.777');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000e', NULL, '維修師傅資訊卡', '顯示派遣技師的聯繫資訊', '服務類', 'LINE', 'flex', '{"text": "維修師傅資訊", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "維修師傅資訊", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "姓名：{{attribute.technician}}", "type": "text"}, {"size": "sm", "text": "電話：{{attribute.techPhone}}", "type": "text"}, {"size": "sm", "text": "到府時段：{{attribute.visitTime}}", "type": "text"}]}]}, "type": "bubble"}}', '[{"key": "attribute.technician", "label": "技師姓名", "required": true}, {"key": "attribute.techPhone", "label": "技師電話", "required": true}, {"key": "attribute.visitTime", "label": "到府時段", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.778', '2026-03-24 01:09:23.778');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000000f', NULL, '預約確認卡', '服務預約成功的確認卡片', '服務類', 'LINE', 'flex', '{"text": "預約確認", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "預約確認", "type": "text", "color": "#1DB446", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "{{contact.name}} 您好", "type": "text"}, {"size": "sm", "text": "日期：{{attribute.appointmentDate}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "時段：{{attribute.appointmentTime}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "地址：{{attribute.address}}", "type": "text", "color": "#555555"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.appointmentDate", "label": "預約日期", "required": true}, {"key": "attribute.appointmentTime", "label": "預約時段", "required": true}, {"key": "attribute.address", "label": "地址", "required": false, "defaultValue": "待確認"}]', NULL, true, true, 0, '2026-03-24 01:09:23.779', '2026-03-24 01:09:23.779');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000010', NULL, '預約提醒（前一天）', '預約前一天發送的提醒', '服務類', 'LINE', 'flex', '{"text": "預約提醒", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "預約提醒", "type": "text", "color": "#FF6B6B", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "{{contact.name}} 您好，提醒您明天有預約服務", "type": "text"}, {"size": "sm", "text": "日期：{{attribute.appointmentDate}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "時段：{{attribute.appointmentTime}}", "type": "text", "color": "#555555"}, {"size": "xs", "text": "如需更改請提前聯繫我們", "type": "text", "color": "#888888"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.appointmentDate", "label": "預約日期", "required": true}, {"key": "attribute.appointmentTime", "label": "預約時段", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.78', '2026-03-24 01:09:23.78');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000011', NULL, '預約取消確認', '確認預約已取消', '服務類', 'LINE', 'flex', '{"text": "預約取消確認", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "預約取消確認", "type": "text", "color": "#888888", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "{{contact.name}} 您好，您的預約已取消。", "type": "text"}, {"size": "sm", "text": "原預約日期：{{attribute.appointmentDate}}", "type": "text", "color": "#555555"}, {"size": "xs", "text": "如需重新預約，歡迎隨時聯繫我們。", "type": "text", "color": "#888888"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.appointmentDate", "label": "原預約日期", "required": false}]', NULL, true, true, 0, '2026-03-24 01:09:23.781', '2026-03-24 01:09:23.781');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000012', NULL, '新品上市公告', '新產品上市推播', '行銷類', 'LINE', 'flex', '{"text": "新品上市：{{attribute.productName}}", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "xl", "text": "{{attribute.productName}}", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.productDesc}}", "type": "text", "wrap": true, "color": "#555555", "margin": "md"}, {"size": "lg", "text": "售價 NT$ {{attribute.price}}", "type": "text", "color": "#1DB446", "margin": "md", "weight": "bold"}]}, "hero": {"url": "{{attribute.imageUrl}}", "size": "full", "type": "image", "aspectMode": "cover", "aspectRatio": "20:13"}, "type": "bubble"}}', '[{"key": "attribute.productName", "label": "產品名稱", "required": true}, {"key": "attribute.productDesc", "label": "產品描述", "required": false, "defaultValue": "全新上市"}, {"key": "attribute.price", "label": "售價", "required": true}, {"key": "attribute.imageUrl", "label": "圖片網址", "required": false, "defaultValue": "https://placehold.co/600x400"}]', NULL, true, true, 0, '2026-03-24 01:09:23.783', '2026-03-24 01:09:23.783');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000013', NULL, '限時優惠 Banner', '限時促銷的推播卡片', '行銷類', 'LINE', 'flex', '{"text": "限時優惠！{{attribute.promoTitle}}", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "xl", "text": "限時優惠", "type": "text", "color": "#FF0000", "weight": "bold"}, {"size": "lg", "text": "{{attribute.promoTitle}}", "type": "text", "margin": "md", "weight": "bold"}, {"size": "sm", "text": "{{attribute.promoDesc}}", "type": "text", "wrap": true, "color": "#555555", "margin": "sm"}, {"size": "xs", "text": "活動期間：{{attribute.promoDate}}", "type": "text", "color": "#888888", "margin": "md"}]}, "type": "bubble"}}', '[{"key": "attribute.promoTitle", "label": "活動標題", "required": true}, {"key": "attribute.promoDesc", "label": "活動描述", "required": false, "defaultValue": "詳情請洽客服"}, {"key": "attribute.promoDate", "label": "活動期間", "required": false, "defaultValue": "即日起"}]', NULL, true, true, 0, '2026-03-24 01:09:23.784', '2026-03-24 01:09:23.784');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000014', NULL, '延伸保固方案介紹', '延長保固的推銷卡片', '行銷類', 'LINE', 'flex', '{"text": "延伸保固方案", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "延伸保固方案", "type": "text", "color": "#1DB446", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "{{contact.name}} 您好", "type": "text"}, {"size": "sm", "text": "您的 {{attribute.model}} 保固即將到期", "type": "text"}, {"size": "sm", "text": "方案：{{attribute.planName}}", "type": "text", "color": "#555555"}, {"size": "sm", "text": "費用：NT$ {{attribute.planPrice}}", "type": "text", "color": "#1DB446", "weight": "bold"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.model", "label": "產品型號", "required": false, "defaultValue": "您的產品"}, {"key": "attribute.planName", "label": "方案名稱", "required": true}, {"key": "attribute.planPrice", "label": "費用", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.785', '2026-03-24 01:09:23.785');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000015', NULL, '會員積點通知', '通知客戶目前積點和到期資訊', '行銷類', 'LINE', 'flex', '{"text": "會員積點通知", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "會員積點通知", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "{{contact.name}} 您好", "type": "text"}, {"size": "lg", "text": "目前積點：{{attribute.points}} 點", "type": "text", "color": "#1DB446", "weight": "bold"}, {"size": "xs", "text": "到期日：{{attribute.expiryDate}}", "type": "text", "color": "#888888"}, {"size": "sm", "text": "趕快使用您的積點兌換好禮吧！", "type": "text", "margin": "md"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.points", "label": "積點數量", "required": true}, {"key": "attribute.expiryDate", "label": "到期日", "required": false, "defaultValue": "請查看帳戶"}]', NULL, true, true, 0, '2026-03-24 01:09:23.787', '2026-03-24 01:09:23.787');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000016', NULL, '促銷活動倒數', '促銷活動倒數計時提醒', '行銷類', 'LINE', 'flex', '{"text": "促銷倒數：{{attribute.promoTitle}}", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "xl", "text": "倒數計時", "type": "text", "color": "#FF0000", "weight": "bold"}, {"size": "lg", "text": "{{attribute.promoTitle}}", "type": "text", "margin": "md", "weight": "bold"}, {"size": "xl", "text": "剩餘 {{attribute.daysLeft}} 天", "type": "text", "color": "#FF6B6B", "margin": "md", "weight": "bold"}, {"size": "sm", "text": "把握最後機會，立即搶購！", "type": "text", "color": "#555555", "margin": "sm"}]}, "type": "bubble"}}', '[{"key": "attribute.promoTitle", "label": "活動標題", "required": true}, {"key": "attribute.daysLeft", "label": "剩餘天數", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.788', '2026-03-24 01:09:23.788');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000017', NULL, '產品比較卡', '兩項產品的規格比較', '產品資訊類', 'LINE', 'flex', '{"text": "產品比較", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "產品比較", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "horizontal", "margin": "md", "contents": [{"flex": 1, "type": "box", "layout": "vertical", "contents": [{"size": "sm", "text": "{{attribute.product1}}", "type": "text", "weight": "bold"}, {"size": "xs", "text": "{{attribute.spec1}}", "type": "text", "wrap": true, "color": "#555555"}, {"size": "sm", "text": "NT$ {{attribute.price1}}", "type": "text", "color": "#1DB446", "weight": "bold"}]}, {"type": "separator", "margin": "md"}, {"flex": 1, "type": "box", "layout": "vertical", "contents": [{"size": "sm", "text": "{{attribute.product2}}", "type": "text", "weight": "bold"}, {"size": "xs", "text": "{{attribute.spec2}}", "type": "text", "wrap": true, "color": "#555555"}, {"size": "sm", "text": "NT$ {{attribute.price2}}", "type": "text", "color": "#1DB446", "weight": "bold"}]}]}]}, "type": "bubble"}}', '[{"key": "attribute.product1", "label": "產品1名稱", "required": true}, {"key": "attribute.spec1", "label": "產品1規格", "required": false, "defaultValue": "-"}, {"key": "attribute.price1", "label": "產品1售價", "required": true}, {"key": "attribute.product2", "label": "產品2名稱", "required": true}, {"key": "attribute.spec2", "label": "產品2規格", "required": false, "defaultValue": "-"}, {"key": "attribute.price2", "label": "產品2售價", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.79', '2026-03-24 01:09:23.79');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000018', NULL, '常用功能說明', '產品常用功能圖文說明', '產品資訊類', 'LINE', 'flex', '{"text": "常用功能說明", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "{{attribute.model}} 常用功能", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "md", "contents": [{"size": "sm", "text": "1. {{attribute.feature1}}", "type": "text", "wrap": true}, {"size": "sm", "text": "2. {{attribute.feature2}}", "type": "text", "wrap": true}, {"size": "sm", "text": "3. {{attribute.feature3}}", "type": "text", "wrap": true}]}]}, "type": "bubble"}}', '[{"key": "attribute.model", "label": "產品型號", "required": true}, {"key": "attribute.feature1", "label": "功能1", "required": true}, {"key": "attribute.feature2", "label": "功能2", "required": false, "defaultValue": "-"}, {"key": "attribute.feature3", "label": "功能3", "required": false, "defaultValue": "-"}]', NULL, true, true, 0, '2026-03-24 01:09:23.792', '2026-03-24 01:09:23.792');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000019', NULL, 'QR Code 說明書連結', '提供產品說明書 QR Code 連結', '產品資訊類', 'LINE', 'flex', '{"text": "產品說明書連結", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "產品說明書", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "型號：{{attribute.model}}", "type": "text"}, {"size": "sm", "text": "請掃描 QR Code 或點擊下方連結查看完整說明書", "type": "text", "wrap": true, "color": "#555555"}, {"size": "xs", "text": "{{attribute.manualUrl}}", "type": "text", "wrap": true, "color": "#1DB446", "margin": "md"}]}]}, "type": "bubble"}}', '[{"key": "attribute.model", "label": "產品型號", "required": true}, {"key": "attribute.manualUrl", "label": "說明書連結", "required": true}]', NULL, true, true, 0, '2026-03-24 01:09:23.793', '2026-03-24 01:09:23.793');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001a', NULL, '問卷調查（單選）', '單選問卷調查卡片', '互動類', 'LINE', 'flex', '{"text": "問卷調查", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "問卷調查", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.question}}", "type": "text", "wrap": true, "margin": "md"}]}, "type": "bubble", "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": [{"type": "button", "style": "primary", "action": {"data": "survey=1", "type": "postback", "label": "{{attribute.option1}}"}, "height": "sm"}, {"type": "button", "style": "secondary", "action": {"data": "survey=2", "type": "postback", "label": "{{attribute.option2}}"}, "height": "sm"}, {"type": "button", "style": "secondary", "action": {"data": "survey=3", "type": "postback", "label": "{{attribute.option3}}"}, "height": "sm"}]}}}', '[{"key": "attribute.question", "label": "問題", "required": true}, {"key": "attribute.option1", "label": "選項1", "required": true}, {"key": "attribute.option2", "label": "選項2", "required": true}, {"key": "attribute.option3", "label": "選項3", "required": false, "defaultValue": "其他"}]', NULL, true, true, 0, '2026-03-24 01:09:23.794', '2026-03-24 01:09:23.794');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001b', NULL, '問卷調查（多選）', '多選問卷調查卡片', '互動類', 'LINE', 'flex', '{"text": "多選問卷", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "多選問卷", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.question}}", "type": "text", "wrap": true, "margin": "md"}, {"size": "xs", "text": "（可複選，請依序回覆選項編號）", "type": "text", "color": "#888888", "margin": "sm"}]}, "type": "bubble", "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": [{"type": "button", "style": "secondary", "action": {"data": "multi=1", "type": "postback", "label": "1. {{attribute.option1}}"}, "height": "sm"}, {"type": "button", "style": "secondary", "action": {"data": "multi=2", "type": "postback", "label": "2. {{attribute.option2}}"}, "height": "sm"}, {"type": "button", "style": "secondary", "action": {"data": "multi=3", "type": "postback", "label": "3. {{attribute.option3}}"}, "height": "sm"}, {"type": "button", "style": "secondary", "action": {"data": "multi=4", "type": "postback", "label": "4. {{attribute.option4}}"}, "height": "sm"}]}}}', '[{"key": "attribute.question", "label": "問題", "required": true}, {"key": "attribute.option1", "label": "選項1", "required": true}, {"key": "attribute.option2", "label": "選項2", "required": true}, {"key": "attribute.option3", "label": "選項3", "required": false, "defaultValue": "選項3"}, {"key": "attribute.option4", "label": "選項4", "required": false, "defaultValue": "其他"}]', NULL, true, true, 0, '2026-03-24 01:09:23.796', '2026-03-24 01:09:23.796');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001c', NULL, '搜尋結果卡（輪播）', '多筆搜尋結果的輪播卡片', '互動類', 'LINE', 'flex', '{"text": "搜尋結果", "flexJson": {"type": "carousel", "contents": [{"body": {"type": "box", "layout": "vertical", "contents": [{"size": "md", "text": "{{attribute.result1Title}}", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.result1Desc}}", "type": "text", "wrap": true, "color": "#555555", "margin": "sm"}]}, "type": "bubble"}, {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "md", "text": "{{attribute.result2Title}}", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.result2Desc}}", "type": "text", "wrap": true, "color": "#555555", "margin": "sm"}]}, "type": "bubble"}, {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "md", "text": "{{attribute.result3Title}}", "type": "text", "weight": "bold"}, {"size": "sm", "text": "{{attribute.result3Desc}}", "type": "text", "wrap": true, "color": "#555555", "margin": "sm"}]}, "type": "bubble"}]}}', '[{"key": "attribute.result1Title", "label": "結果1標題", "required": true}, {"key": "attribute.result1Desc", "label": "結果1描述", "required": false, "defaultValue": "-"}, {"key": "attribute.result2Title", "label": "結果2標題", "required": false, "defaultValue": "-"}, {"key": "attribute.result2Desc", "label": "結果2描述", "required": false, "defaultValue": "-"}, {"key": "attribute.result3Title", "label": "結果3標題", "required": false, "defaultValue": "-"}, {"key": "attribute.result3Desc", "label": "結果3描述", "required": false, "defaultValue": "-"}]', NULL, true, true, 0, '2026-03-24 01:09:23.797', '2026-03-24 01:09:23.797');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001d', NULL, '個人儀表板', '顯示客戶個人化資訊', '互動類', 'LINE', 'flex', '{"text": "個人儀表板", "flexJson": {"body": {"type": "box", "layout": "vertical", "contents": [{"size": "lg", "text": "{{contact.name}} 的儀表板", "type": "text", "weight": "bold"}, {"type": "separator", "margin": "md"}, {"type": "box", "layout": "vertical", "margin": "md", "spacing": "sm", "contents": [{"size": "sm", "text": "案件數：{{attribute.caseCount}}", "type": "text"}, {"size": "sm", "text": "未結案件：{{attribute.openCases}}", "type": "text", "color": "#FF6B6B"}, {"size": "sm", "text": "會員積點：{{attribute.points}}", "type": "text", "color": "#1DB446"}, {"size": "xs", "text": "上次互動：{{attribute.lastInteraction}}", "type": "text", "color": "#888888", "margin": "md"}]}]}, "type": "bubble"}}', '[{"key": "contact.name", "label": "客戶名稱", "required": false, "defaultValue": "您"}, {"key": "attribute.caseCount", "label": "案件數", "required": false, "defaultValue": "0"}, {"key": "attribute.openCases", "label": "未結案件", "required": false, "defaultValue": "0"}, {"key": "attribute.points", "label": "積點", "required": false, "defaultValue": "0"}, {"key": "attribute.lastInteraction", "label": "上次互動", "required": false, "defaultValue": "-"}]', NULL, true, true, 0, '2026-03-24 01:09:23.799', '2026-03-24 01:09:23.799');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-00000000001f', NULL, 'FB 通用卡片', 'Facebook 通用卡片模板（單卡）', 'FB模板', 'FB', 'fb_generic', '{"text": "{{attribute.title}}", "fbElements": [{"title": "{{attribute.title}}", "buttons": [{"url": "{{attribute.detailUrl}}", "type": "web_url", "title": "查看詳情"}, {"type": "postback", "title": "聯繫客服", "payload": "CONTACT_AGENT"}], "imageUrl": "{{attribute.imageUrl}}", "subtitle": "{{attribute.subtitle}}"}]}', '[{"key": "attribute.title", "label": "標題", "required": true}, {"key": "attribute.subtitle", "label": "副標題", "required": false, "defaultValue": ""}, {"key": "attribute.imageUrl", "label": "圖片網址", "required": false, "defaultValue": "https://placehold.co/600x400"}, {"key": "attribute.detailUrl", "label": "詳情連結", "required": false, "defaultValue": "#"}]', NULL, true, true, 0, '2026-03-24 01:09:23.801', '2026-03-24 01:09:23.801');
INSERT INTO public.message_templates VALUES ('da000000-0000-0000-0000-000000000020', NULL, 'FB 輪播卡', 'Facebook 輪播卡模板（多卡）', 'FB模板', 'FB', 'fb_carousel', '{"text": "精選推薦", "fbElements": [{"title": "{{attribute.card1Title}}", "buttons": [{"url": "{{attribute.card1Url}}", "type": "web_url", "title": "了解更多"}], "imageUrl": "{{attribute.card1Image}}", "subtitle": "{{attribute.card1Desc}}"}, {"title": "{{attribute.card2Title}}", "buttons": [{"url": "{{attribute.card2Url}}", "type": "web_url", "title": "了解更多"}], "imageUrl": "{{attribute.card2Image}}", "subtitle": "{{attribute.card2Desc}}"}, {"title": "{{attribute.card3Title}}", "buttons": [{"url": "{{attribute.card3Url}}", "type": "web_url", "title": "了解更多"}], "imageUrl": "{{attribute.card3Image}}", "subtitle": "{{attribute.card3Desc}}"}]}', '[{"key": "attribute.card1Title", "label": "卡片1標題", "required": true}, {"key": "attribute.card1Desc", "label": "卡片1描述", "required": false, "defaultValue": ""}, {"key": "attribute.card1Image", "label": "卡片1圖片", "required": false, "defaultValue": "https://placehold.co/600x400"}, {"key": "attribute.card1Url", "label": "卡片1連結", "required": false, "defaultValue": "#"}, {"key": "attribute.card2Title", "label": "卡片2標題", "required": false, "defaultValue": "產品2"}, {"key": "attribute.card2Desc", "label": "卡片2描述", "required": false, "defaultValue": ""}, {"key": "attribute.card2Image", "label": "卡片2圖片", "required": false, "defaultValue": "https://placehold.co/600x400"}, {"key": "attribute.card2Url", "label": "卡片2連結", "required": false, "defaultValue": "#"}, {"key": "attribute.card3Title", "label": "卡片3標題", "required": false, "defaultValue": "產品3"}, {"key": "attribute.card3Desc", "label": "卡片3描述", "required": false, "defaultValue": ""}, {"key": "attribute.card3Image", "label": "卡片3圖片", "required": false, "defaultValue": "https://placehold.co/600x400"}, {"key": "attribute.card3Url", "label": "卡片3連結", "required": false, "defaultValue": "#"}]', NULL, true, true, 0, '2026-03-24 01:09:23.802', '2026-03-24 01:09:23.802');


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "你好，我家的冰箱從昨天開始就不太冷了，請問可以幫忙處理嗎？"}', NULL, true, '2026-03-23 23:09:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'OUTBOUND', 'AGENT', 'b0000000-0000-0000-0000-000000000003', 'text', '{"text": "王小姐您好！感謝您的來訊。請問您的冰箱型號是什麼呢？大概使用多久了？"}', NULL, true, '2026-03-23 23:11:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "型號是 Samsung RF90K，買了大概兩年多"}', NULL, true, '2026-03-23 23:13:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'OUTBOUND', 'AGENT', 'b0000000-0000-0000-0000-000000000003', 'text', '{"text": "好的，RF90K 還在三年保固期內。我先幫您建立維修工單，會安排技師盡快與您聯繫。"}', NULL, true, '2026-03-23 23:15:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000001', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "好的謝謝你，大概什麼時候會有人聯繫我呢？"}', NULL, true, '2026-03-23 23:17:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000001', 'OUTBOUND', 'AGENT', 'b0000000-0000-0000-0000-000000000003', 'text', '{"text": "通常 24 小時內會有技師主動致電，我已經把您列為優先處理。有任何問題隨時跟我們說！"}', NULL, true, '2026-03-23 23:19:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000002', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "我想問一下，我去年買的洗衣機保固到什麼時候？"}', NULL, false, '2026-03-24 00:39:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000008', 'f0000000-0000-0000-0000-000000000002', 'OUTBOUND', 'BOT', NULL, 'text', '{"text": "您好！歡迎使用客服系統。正在為您轉接客服人員..."}', NULL, true, '2026-03-24 00:40:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000009', 'f0000000-0000-0000-0000-000000000002', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "可以快點嗎？我有點急"}', NULL, false, '2026-03-24 00:44:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000010', 'f0000000-0000-0000-0000-000000000002', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "？？有人嗎"}', NULL, false, '2026-03-24 00:49:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000003', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "請問有沒有延長保固的方案？"}', NULL, false, '2026-03-24 00:09:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000012', 'f0000000-0000-0000-0000-000000000003', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "我有一台洗碗機想要加購延保"}', NULL, false, '2026-03-24 00:11:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000013', 'f0000000-0000-0000-0000-000000000003', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "感謝您的詢問，我們的客服人員將盡快為您服務。"}', NULL, true, '2026-03-24 00:14:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000014', 'f0000000-0000-0000-0000-000000000004', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "我想預約維修冷氣"}', NULL, true, '2026-03-22 01:09:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000015', 'f0000000-0000-0000-0000-000000000004', 'OUTBOUND', 'AGENT', 'b0000000-0000-0000-0000-000000000003', 'text', '{"text": "李先生您好，請問方便告訴我您的冷氣品牌和遇到的問題嗎？"}', NULL, true, '2026-03-22 01:12:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000016', 'f0000000-0000-0000-0000-000000000004', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "大金的，開機後會發出怪聲音"}', NULL, true, '2026-03-22 01:14:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000017', 'f0000000-0000-0000-0000-000000000004', 'OUTBOUND', 'AGENT', 'b0000000-0000-0000-0000-000000000003', 'text', '{"text": "了解，我已經幫您安排本週五下午 2-4 點的維修時段，技師會提前致電確認。"}', NULL, true, '2026-03-22 01:17:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000018', 'f0000000-0000-0000-0000-000000000004', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "太好了，謝謝！"}', NULL, true, '2026-03-22 01:19:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000019', 'f0000000-0000-0000-0000-000000000005', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "你們的售後服務也太差了吧！修了三次都沒修好！"}', NULL, false, '2026-03-24 00:59:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000020', 'f0000000-0000-0000-0000-000000000005', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "我要投訴！請你們主管跟我聯繫！"}', NULL, false, '2026-03-24 01:01:23.129', '{}');
INSERT INTO public.messages VALUES ('dd000000-0000-0000-0000-000000000021', 'f0000000-0000-0000-0000-000000000005', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "再不處理我就去消保會檢舉"}', NULL, false, '2026-03-24 01:04:23.129', '{}');
INSERT INTO public.messages VALUES ('4d605cc5-6b33-4cdf-b9f8-06f720ef05c6', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "你好"}', '606471341340099123', false, '2026-03-24 01:39:53.27', '{"sentiment": {"score": 0.6, "sentiment": "positive", "confidence": 0.5}}');
INSERT INTO public.messages VALUES ('63b78ece-2d8a-4d9b-95e2-73767a841098', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "測試"}', '606471903443419191', false, '2026-03-24 01:45:28.249', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('12a110cc-fa49-4130-8af5-dd1f5f15225d', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "故障"}', '606472246671966588', false, '2026-03-24 01:48:52.825', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('ed7b86c8-29bd-4886-8c7a-b85473ad320a', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "故障"}', '606472518395494473', false, '2026-03-24 01:51:34.891', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('47154929-34ae-4285-9d64-eff3bb534365', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "我已經為您建立維修服務單，將盡快安排技師為您處理。請問方便提供您的產品型號和購買時間嗎？"}', NULL, false, '2026-03-24 01:51:34.964', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('c25a8e2d-6b13-45d4-b5ca-1beda35f8719', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "非常抱歉造成您的不便，我已經為您建立服務案件，將由專人盡速為您處理。"}', NULL, false, '2026-03-24 01:51:35.186', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('8d4024c9-a05e-460a-92d6-591a8a9158e9', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "冰箱不冷怎麼辦"}', '606472769332838541', false, '2026-03-24 01:54:04.616', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('723f403b-4d48-45b5-bee4-0dba93da6e81', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "冰箱不冷怎麼辦"}', '606473500752085543', false, '2026-03-24 02:01:20.603', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('5fba1894-9fbc-421a-b601-0bc1c39dc366', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "  冰箱不冷怎麼辦"}', '606473910703095983', false, '2026-03-24 02:05:24.96', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.4}}');
INSERT INTO public.messages VALUES ('77fde1c7-14b4-4287-82d4-40560432a590', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "冰箱不冷怎麼辦"}', '606475352755143170', false, '2026-03-24 02:19:44.188', '{"sentiment": {"score": -0.2, "sentiment": "negative", "confidence": 0.95}}');
INSERT INTO public.messages VALUES ('342e7edf-afff-4137-8f8f-9db29571f64c', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "故障了"}', '606475473416880698', false, '2026-03-24 02:20:55.989', '{"sentiment": {"score": -0.76, "sentiment": "negative", "confidence": 0.94}}');
INSERT INTO public.messages VALUES ('f3531e82-9e8d-404b-91d0-27624cd926c2', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "我已經為您建立維修服務單，將盡快安排技師為您處理。請問方便提供您的產品型號和購買時間嗎？"}', NULL, false, '2026-03-24 02:20:59.137', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('4d6e66ed-3a93-4fab-923b-fb8cdf1bf030', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "非常抱歉造成您的不便，我已經為您建立服務案件，將由專人盡速為您處理。"}', NULL, false, '2026-03-24 02:20:59.423', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('00eb3c2c-946b-4895-85be-175627f5e90c', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "保固"}', '606475491771416770', false, '2026-03-24 02:21:07.295', '{"sentiment": {"score": 0.123, "sentiment": "neutral", "confidence": 0.789}}');
INSERT INTO public.messages VALUES ('b4f677d3-c8bd-4a6f-88b9-3921c72cabb7', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "我已經為您建立維修服務單，將盡快安排技師為您處理。請問方便提供您的產品型號和購買時間嗎？"}', NULL, false, '2026-03-24 02:21:10.655', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('fb4d1762-5b56-46bb-869a-19ad0295beaf', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'SYSTEM', NULL, 'text', '{"text": "非常抱歉造成您的不便，我已經為您建立服務案件，將由專人盡速為您處理。"}', NULL, false, '2026-03-24 02:21:10.905', '{"source": "automation"}');
INSERT INTO public.messages VALUES ('5b3872aa-129c-4bad-bc46-e7b80c1a2aab', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": " 你好，我想詢問產品資訊"}', '606475572888994007', false, '2026-03-24 02:21:55.661', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 0.5}}');
INSERT INTO public.messages VALUES ('ad9231f7-8556-4ebc-8b15-a8a1b0fc270b', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'BOT', NULL, 'text', '{"text": "您好，您可以告訴我是哪一款冰箱以及您在幾年前購買的，這樣我可以提供更詳細的信息給您。還有其他需要幫忙的嗎？"}', NULL, false, '2026-03-24 02:22:13.501', '{"source": "llm_reply"}');
INSERT INTO public.messages VALUES ('d37daf1e-4859-48c2-81c1-c92389fdf0c7', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "  冰箱不冷怎麼辦"}', '606475625385165081', false, '2026-03-24 02:22:26.765', '{"sentiment": {"score": -0.5, "sentiment": "negative", "confidence": 0.8}}');
INSERT INTO public.messages VALUES ('7b96ef70-de7a-4183-8e42-25459bbe81de', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'BOT', NULL, 'text', '{"text": "您好，冰箱不冷的話請檢查門封是否鬆動或有損壞，並確保溫度設定正確。如果問題持續，建議聯繫服務中心進行維修。還有其他需要幫助的嗎？"}', NULL, false, '2026-03-24 02:22:52.478', '{"source": "llm_reply"}');
INSERT INTO public.messages VALUES ('5bfc15f9-a56b-4b52-8a55-9fbc8c5341a6', '3525deb9-e07c-42be-a107-8ec7783019fe', 'INBOUND', 'CONTACT', NULL, 'text', '{"text": "洗衣機常見問題排除"}', '606475726014644507', false, '2026-03-24 02:23:26.608', '{"sentiment": {"score": 0, "sentiment": "neutral", "confidence": 1}}');
INSERT INTO public.messages VALUES ('bb2d8f85-f3b9-43c1-89bd-c2f4a1b50e69', '3525deb9-e07c-42be-a107-8ec7783019fe', 'OUTBOUND', 'BOT', NULL, 'text', '{"text": "您好，洗衣機常見問題包括水壓不足、排水不暢等，您可以先檢查相關設置和管道是否正常。如果問題依然存在，建議聯繫服務中心進行檢查和維修。還有其他需要幫助的嗎？"}', NULL, false, '2026-03-24 02:24:04.576', '{"source": "llm_reply"}');


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.notifications VALUES ('90d967b3-1b14-4377-b6d0-16f3d3d37cef', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 02:09:51.8');
INSERT INTO public.notifications VALUES ('ad36d39a-6194-40e0-9258-f4fa0bfff64f', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 02:09:51.805');
INSERT INTO public.notifications VALUES ('068fe2f6-cbc7-41a0-b807-683f8c3d52b2', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 02:09:51.81');
INSERT INTO public.notifications VALUES ('3468e29e-7a70-4156-a88d-127b62b5c4b2', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'sla_warning', 'SLA 即將到期', '工單「冰箱不製冷維修」的 SLA 即將到期，請加速處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 04:55:22.562');
INSERT INTO public.notifications VALUES ('e4f1b917-14c4-4294-9abe-ee9f9d4e27da', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 05:10:22.594');
INSERT INTO public.notifications VALUES ('fd7826fc-8e7c-4bdb-85d3-8844049ecc22', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 05:10:22.606');
INSERT INTO public.notifications VALUES ('4c4871fa-2520-4a9e-9df3-a7242875d2a8', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-24 05:10:22.608');
INSERT INTO public.notifications VALUES ('a1885cc3-3985-4e99-b3e9-79fecdc9cca0', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'sla_breached', 'SLA 已逾期', '工單「洗衣機噪音問題」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000002', false, NULL, '2026-03-24 05:10:22.615');
INSERT INTO public.notifications VALUES ('59fdf1e4-f539-4af0-ba70-091c473b1a6d', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'sla_breached', 'SLA 已逾期', '工單「洗衣機噪音問題」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000002', false, NULL, '2026-03-24 05:10:22.617');
INSERT INTO public.notifications VALUES ('e688726c-f81a-46f4-8f30-cff9898ebfe4', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-25 02:10:16.668');
INSERT INTO public.notifications VALUES ('afa134e1-1c3f-44f9-9de2-bebbdd20a204', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-25 02:10:16.683');
INSERT INTO public.notifications VALUES ('0894a097-b0c8-4b17-8cd1-960b1177e76d', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'sla_breached', 'SLA 已逾期', '工單「冰箱不製冷維修」的 SLA 已逾期，請立即處理', '/dashboard/cases/a1000000-0000-0000-0000-000000000001', false, NULL, '2026-03-25 02:10:16.685');


--
-- Data for Name: point_transactions; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.point_transactions VALUES ('dc000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 10, 10, 'activity_submit', 'db0c0000-0000-0000-0000-000000000001', '參加活動「最喜歡的產品系列」', '2026-03-19 01:09:23.129');
INSERT INTO public.point_transactions VALUES ('dc000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 10, 10, 'activity_submit', 'db0c0000-0000-0000-0000-000000000002', '參加活動「最喜歡的產品系列」', '2026-03-20 01:09:23.129');
INSERT INTO public.point_transactions VALUES ('dc000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 10, 10, 'activity_submit', 'db0c0000-0000-0000-0000-000000000003', '參加活動「最喜歡的產品系列」', '2026-03-21 01:09:23.129');
INSERT INTO public.point_transactions VALUES ('dc000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 5, 15, 'activity_submit', 'db0c0000-0000-0000-0000-000000000004', '參加活動「線下活動報名」', '2026-03-22 01:09:23.129');
INSERT INTO public.point_transactions VALUES ('dc000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', 5, 5, 'activity_submit', 'db0c0000-0000-0000-0000-000000000005', '參加活動「線下活動報名」', '2026-03-23 01:09:23.129');


--
-- Data for Name: portal_activities; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.portal_activities VALUES ('db000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'POLL', 'PUBLISHED', '最喜歡的產品系列', '投票選出你最喜歡的產品系列，參與即可獲得 10 點積分！', NULL, '{"showResults": true, "pointsPerSubmit": 10}', '2026-03-17 01:09:23.129', '2026-04-07 01:09:23.129', '2026-03-17 01:09:23.129', 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.804', '2026-03-24 01:09:23.804');
INSERT INTO public.portal_activities VALUES ('db000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'FORM', 'PUBLISHED', '線下活動報名', '報名參加我們的線下粉絲見面會', NULL, '{"pointsPerSubmit": 5}', '2026-03-21 01:09:23.129', '2026-03-31 01:09:23.129', '2026-03-21 01:09:23.129', 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.807', '2026-03-24 01:09:23.807');
INSERT INTO public.portal_activities VALUES ('db000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'QUIZ', 'DRAFT', '品牌知識挑戰', '測試你對品牌的了解程度！答對越多分數越高', NULL, '{"pointsPerSubmit": 20}', NULL, NULL, NULL, 'b0000000-0000-0000-0000-000000000001', '2026-03-24 01:09:23.81', '2026-03-24 01:09:23.81');


--
-- Data for Name: portal_fields; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.portal_fields VALUES ('db0b0000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000002', 'name', '姓名', 'text', '[]', true, 0);
INSERT INTO public.portal_fields VALUES ('db0b0000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000002', 'phone', '電話', 'phone', '[]', true, 1);
INSERT INTO public.portal_fields VALUES ('db0b0000-0000-0000-0000-000000000003', 'db000000-0000-0000-0000-000000000002', 'note', '備註', 'textarea', '[]', false, 2);


--
-- Data for Name: portal_options; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', '經典系列', NULL, 0, false);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000001', '創新系列', NULL, 1, false);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000003', 'db000000-0000-0000-0000-000000000001', '環保系列', NULL, 2, false);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000004', 'db000000-0000-0000-0000-000000000001', '聯名系列', NULL, 3, false);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000005', 'db000000-0000-0000-0000-000000000003', '2015 年', NULL, 0, false);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000006', 'db000000-0000-0000-0000-000000000003', '2018 年', NULL, 1, true);
INSERT INTO public.portal_options VALUES ('db0a0000-0000-0000-0000-000000000007', 'db000000-0000-0000-0000-000000000003', '2020 年', NULL, 2, false);


--
-- Data for Name: portal_submissions; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.portal_submissions VALUES ('db0c0000-0000-0000-0000-000000000001', 'db000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '{"optionIds": ["db0a0000-0000-0000-0000-000000000001"]}', NULL, false, 10, '2026-03-19 01:09:23.129');
INSERT INTO public.portal_submissions VALUES ('db0c0000-0000-0000-0000-000000000002', 'db000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '{"optionIds": ["db0a0000-0000-0000-0000-000000000003"]}', NULL, false, 10, '2026-03-20 01:09:23.129');
INSERT INTO public.portal_submissions VALUES ('db0c0000-0000-0000-0000-000000000003', 'db000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '{"optionIds": ["db0a0000-0000-0000-0000-000000000002"]}', NULL, false, 10, '2026-03-21 01:09:23.129');
INSERT INTO public.portal_submissions VALUES ('db0c0000-0000-0000-0000-000000000004', 'db000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '{"fields": {"name": "王小美", "note": "期待見面會", "phone": "0912345678"}}', NULL, false, 5, '2026-03-22 01:09:23.129');
INSERT INTO public.portal_submissions VALUES ('db0c0000-0000-0000-0000-000000000005', 'db000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '{"fields": {"name": "陳小芳", "note": "", "phone": "0945678901"}}', NULL, false, 5, '2026-03-23 01:09:23.129');


--
-- Data for Name: sla_policies; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.sla_policies VALUES ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '低優先', 'LOW', 480, 4320, 60, false, '2026-03-24 01:09:23.722');
INSERT INTO public.sla_policies VALUES ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '中優先', 'MEDIUM', 240, 1440, 30, true, '2026-03-24 01:09:23.723');
INSERT INTO public.sla_policies VALUES ('a2000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '高優先', 'HIGH', 60, 240, 15, false, '2026-03-24 01:09:23.724');
INSERT INTO public.sla_policies VALUES ('a2000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '緊急', 'URGENT', 15, 60, 5, false, '2026-03-24 01:09:23.725');


--
-- Data for Name: tenant_settings; Type: TABLE DATA; Schema: public; Owner: crm
--

INSERT INTO public.tenant_settings VALUES ('ef000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Asia/Taipei', '{"holidays": [], "schedule": {"fri": {"end": "18:00", "start": "09:00", "enabled": true}, "mon": {"end": "18:00", "start": "09:00", "enabled": true}, "sat": {"end": "14:00", "start": "10:00", "enabled": true}, "sun": {"end": "18:00", "start": "09:00", "enabled": false}, "thu": {"end": "18:00", "start": "09:00", "enabled": true}, "tue": {"end": "18:00", "start": "09:00", "enabled": true}, "wed": {"end": "18:00", "start": "09:00", "enabled": true}}, "autoReplyMessage": "感謝您的來訊！目前非營業時間（週一至週五 9:00-18:00，週六 10:00-14:00），我們將在營業時間盡速回覆您。"}', '2026-03-24 01:09:23.858', '2026-03-24 01:09:23.858');


--
-- Data for Name: webhook_subscriptions; Type: TABLE DATA; Schema: public; Owner: crm
--



--
-- Data for Name: webhook_deliveries; Type: TABLE DATA; Schema: public; Owner: crm
--



--
-- PostgreSQL database dump complete
--

\unrestrict a6RFR96wn8X4TWaQmfc9iT1EBudIGvbKNVuMeeF5PUY7KPuWixyx7JixjhaSfev

