"use client";

import { useCallback, useEffect, useState } from "react";
import type { UserLocation } from "../models/map-state";

export function useUserLocation() {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const requestLocation = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setError("当前浏览器不支持地理定位");
      return;
    }

    setLoading(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          updatedAt: Date.now(),
        });
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setError("开启定位后可查看当前位置与下一站路线");
        } else {
          setError("获取位置信息失败，请稍后重试");
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      },
    );
  }, []);

  useEffect(() => {
    // Attempt automatic soft location query once mounted
    requestLocation();
  }, [requestLocation]);

  return {
    location,
    error,
    loading,
    requestLocation,
  };
}
