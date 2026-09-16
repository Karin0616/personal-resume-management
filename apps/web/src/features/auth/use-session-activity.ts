"use client";
import { useEffect } from "react";
import { api } from "../api";
export function useSessionActivity(enabled:boolean) {
  useEffect(()=> {
    if(!enabled)return;
    let active=false;
    const mark=()=>{active=true;};
    window.addEventListener("pointerdown",mark);window.addEventListener("keydown",mark);
    const timer=setInterval(()=>{if(active&&document.visibilityState==="visible"){active=false;void api("auth/session/activity","POST").catch(()=>{});}},60_000);
    return ()=>{clearInterval(timer);window.removeEventListener("pointerdown",mark);window.removeEventListener("keydown",mark);};
  },[enabled]);
}
