// @ts-nocheck
import { useState, useEffect } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { FiUsers } from 'react-icons/fi';

export default function MapComponent({ ipInfo, peerIpInfo, distance, onError }) {
  const [viewState, setViewState] = useState({
    latitude: 0,
    longitude: 0,
    zoom: 1
  });

  useEffect(() => {
    try {
      // 如果有两个IP地址，将视图中心设置为两者中间点
      if (ipInfo?.latitude && ipInfo?.longitude && peerIpInfo?.latitude && peerIpInfo?.longitude) {
        const lat1 = parseFloat(ipInfo.latitude);
        const lng1 = parseFloat(ipInfo.longitude);
        const lat2 = parseFloat(peerIpInfo.latitude);
        const lng2 = parseFloat(peerIpInfo.longitude);
        
        const midLat = (lat1 + lat2) / 2;
        const midLng = (lng1 + lng2) / 2;
        
        // 计算适当的缩放级别
        const latDiff = Math.abs(lat1 - lat2);
        const lngDiff = Math.abs(lng1 - lng2);
        const maxDiff = Math.max(latDiff, lngDiff);
        let zoom = 1;
        
        if (maxDiff < 1) zoom = 10;
        else if (maxDiff < 5) zoom = 6;
        else if (maxDiff < 20) zoom = 4;
        else if (maxDiff < 60) zoom = 3;
        else zoom = 2;
        
        setViewState({
          latitude: midLat,
          longitude: midLng,
          zoom: zoom
        });
      } 
      // 如果只有本地IP，居中显示
      else if (ipInfo?.latitude && ipInfo?.longitude) {
        setViewState({
          latitude: parseFloat(ipInfo.latitude),
          longitude: parseFloat(ipInfo.longitude),
          zoom: 5
        });
      }
    } catch (error) {
      console.error('Error setting map view state:', error);
      if (onError) onError(error);
    }
  }, [ipInfo, peerIpInfo]);

  const renderMarker = (info, isPeer = false) => {
    if (!info || !info.latitude || !info.longitude) return null;
    
    try {
      return (
        <Marker 
          latitude={parseFloat(info.latitude)} 
          longitude={parseFloat(info.longitude)} 
          offsetLeft={-20} 
          offsetTop={-40}
        >
          <div className="relative">
            <div className={`w-8 h-8 rounded-full ${isPeer ? 'bg-green-500' : 'bg-blue-500'} flex items-center justify-center shadow-md`}>
              <span className="text-white text-lg">{isPeer ? '🧑‍💻' : '👤'}</span>
            </div>
            <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 bg-white dark:bg-gray-800 px-2 py-1 rounded shadow-md text-xs whitespace-nowrap">
              {info.city || '未知'}, {info.country_name || '未知'}
            </div>
          </div>
        </Marker>
      );
    } catch (error) {
      console.error('Error rendering marker:', error);
      return null;
    }
  };

  // 使用备用的Mapbox token，以防环境变量未设置
  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || 
                       "pk.eyJ1IjoicmF2ZWxsb2giLCJhIjoiY2xvenkwOHd1MDFhbzJrbzZ4bWR5NnlpMCJ9.X6bT4qCVnfA-PsBfGcS8eg";

  try {
    return (
      <div className="h-60 w-full relative">
        <Map
          {...viewState}
          onMove={evt => setViewState(evt.viewState)}
          mapStyle="mapbox://styles/mapbox/streets-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onError={onError}
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
          {renderMarker(ipInfo, false)}
          {renderMarker(peerIpInfo, true)}
        </Map>
        
        {distance && (
          <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 bg-white/80 dark:bg-gray-800/80 px-2 py-1 rounded shadow-sm backdrop-blur-sm text-xs text-center">
            <FiUsers className="inline mr-1" /> 连接距离约 {distance.toFixed(0)} 公里
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error('Error rendering map:', error);
    if (onError) onError(error);
    return (
      <div className="h-60 w-full flex items-center justify-center bg-gray-100 dark:bg-gray-800">
        <p className="text-gray-500 dark:text-gray-400">地图渲染失败</p>
      </div>
    );
  }
}
