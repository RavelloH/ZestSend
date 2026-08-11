// @ts-nocheck
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// 生成4位随机数字
export function generateRoomId() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// 检查输入的房间ID是否有效
export function isValidRoomId(roomId) {
  return /^\d{4}$/.test(roomId);
}

// 将字节数转换为可读格式
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 生成文件ID
export function generateFileId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// 将blob转换为buffer
export function blobToBuffer(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buffer = new Uint8Array(reader.result);
      resolve(buffer);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

// 获取文件图标
export function getFileIcon(mimeType) {
  if (mimeType.startsWith('image/')) {
    return '🖼️';
  } else if (mimeType.startsWith('video/')) {
    return '🎬';
  } else if (mimeType.startsWith('audio/')) {
    return '🎵';
  } else if (mimeType === 'application/pdf') {
    return '📄';
  } else if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
    return '📊';
  } else if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
    return '📊';
  } else if (mimeType.includes('document') || mimeType.includes('word')) {
    return '📝';
  } else {
    return '📁';
  }
}

// 获取IP地理位置信息
export async function getIPInfo(ip) {
  try {
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) throw new Error('Failed to fetch IP info');
    return await response.json();
  } catch (error) {
    console.error('Error fetching IP info:', error);
    return { error: 'Failed to fetch IP info' };
  }
}

// 安全的JSON解析
export function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

// ArrayBuffer转换为Array
export function arrayBufferToArray(buffer) {
  return Array.from(new Uint8Array(buffer));
}

// Array转换回ArrayBuffer
export function arrayToArrayBuffer(array) {
  return new Uint8Array(array).buffer;
}

// ArrayBuffer转换为base64字符串
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// base64字符串转换回ArrayBuffer
export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
