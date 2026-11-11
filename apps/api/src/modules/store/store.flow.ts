/**
 * 門市與門市帳號管理（後台）的 flow。route 呼叫這裡，不自己開交易（AGENTS.md 結構規則 2）。
 * 目前每個操作只呼叫一個 service 函式，所以用 flowOf；加上稽核或推播時改寫成一般的 flow 函式。
 */
import { flowOf } from '../../lib/tenant-ctx.js';
import {
  createStore,
  createStoreAccount,
  deleteStoreAccount,
  forceLogoutStoreAccount,
  getStorePoster,
  listStores,
  resetStoreAccountPassword,
  updateStore,
  updateStoreAccount,
} from './store.service.js';

export const listStoresFlow = flowOf(listStores);
export const getStorePosterFlow = flowOf(getStorePoster);
export const createStoreFlow = flowOf(createStore);
export const updateStoreFlow = flowOf(updateStore);
export const createStoreAccountFlow = flowOf(createStoreAccount);
export const updateStoreAccountFlow = flowOf(updateStoreAccount);
export const resetStoreAccountPasswordFlow = flowOf(resetStoreAccountPassword);
export const forceLogoutStoreAccountFlow = flowOf(forceLogoutStoreAccount);
export const deleteStoreAccountFlow = flowOf(deleteStoreAccount);
