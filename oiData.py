from tkinter import *

from tkinter import ttk

import sqlite3

import time

import threading

from datetime import datetime, timedelta

from dateutil.relativedelta import relativedelta

from api_helper import ShoonyaApiPy, get_time

import logging

import pandas as pd

import time

import login

root=Tk()

root.geometry("680x350")

api = ShoonyaApiPy()

count=0

user    = login.user

pwd     = login.pwd

factor2 = login.factor2

vc      = login.vc

app_key = login.app_key

imei    = login.imei

ret = api.login(userid=user, password=pwd, twoFA=factor2, vendor_code=vc, api_secret=app_key, imei=imei)

niftyTokens=[]

expiry=""

niftyToken=""

def startThread(instrument):

    if(instrument=="future"):

        t1=threading.Thread(target=futureOi)

        t1.start()

    elif(instrument=="oi"):

        t1=threading.Thread(target=oiChange)

        t1.start()

            

def optionChain():

    global niftyToken

    global niftyTokens

    widgets= optionFrame.winfo_children()

    for widget in widgets:

        widget.destroy()

    incrementor=50

    startIndex=13

    if(indexName.get()=="NIFTY"):

        niftyToken="26000"

    else:

        niftyToken="26009"

        startIndex=17

        incrementor=100



    ret = api.get_quotes(exchange="NSE", token=niftyToken)

    ltp=int(float(ret["lp"]))

    ltp=(ltp)-(ltp%incrementor)

    exch  = 'NFO'

    query = 'banknifty'

    ret = api.searchscrip(exchange=exch, searchtext=query)

    niftyToken="";

    if ret != None:

        symbols = ret['values']

    for symbol in symbols:

        if(symbol['tsym'].endswith("0")):

            niftyToken=(symbol['tsym'])

            print(niftyToken)

            niftyToken=(niftyToken[9:16])

            print(niftyToken)

            break

    strike=(indexName.get()+niftyToken+"P"+str(ltp))    

    print(strike)

    expiry=niftyToken

    chain = api.get_option_chain(exchange=exch, tradingsymbol=strike, strikeprice=ltp, count=5)

    chainscrips = []

    for scrip in chain['values']:

        scripdata = api.get_quotes(exchange=scrip['exch'], token=scrip['token'])

        chainscrips.append(scripdata)

    print(chainscrips[0]["tsym"]) 

    i=0

    j=9

    Label(optionFrame,text="CHANGE",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=0)

    Label(optionFrame,text="CE OI",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=1)

    Label(optionFrame,text="LTP",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=2)

    Label(optionFrame,text="STRIKE",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=3)

    Label(optionFrame,text="LTP",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=4)

    Label(optionFrame,text="PE OI",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=5)

    Label(optionFrame,text="CHANGE",width=10,bg="blanchedalmond",font=("Arial Black",10)).grid(row=0,column=6)

    while(i<10):

        niftyTokens.append(chainscrips[j]["token"])

        niftyTokens.append(chainscrips[j+10]["token"])

        Label(optionFrame,text="0",width=10,font=("Arial bold",10)).grid(row=i+1,column=0)

        Label(optionFrame,text=chainscrips[j]["oi"],width=10,font=("Arial bold",10)).grid(row=i+1,column=1)

        Label(optionFrame,text=chainscrips[j]["lp"],width=10,font=("Arial bold",10)).grid(row=i+1,column=2)

        button=Button(optionFrame,text=chainscrips[j]["tsym"][startIndex:startIndex+5],width=10,font=("Arial bold",10))

        button.grid(row=i+1,column=3)

        button.bind('<Button>',strikeOi)

        Label(optionFrame,text=chainscrips[j+10]["lp"],width=10,font=("Arial bold",10)).grid(row=i+1,column=4)

        Label(optionFrame,text=chainscrips[j+10]["oi"],width=10,font=("Arial bold",10)).grid(row=i+1,column=5)

        Label(optionFrame,text="0",width=10,font=("Arial bold",10)).grid(row=i+1,column=6)

        

        i+=1

        if(j>5):

            j-=1

        elif(j==5):

            j=0

        elif(j<4):

            j+=1 

def strikeOi(event):

    widgets= middleFrame.winfo_children()

    for widget in widgets:

        widget.destroy()

    end_time = time.time()

    start_secs = end_time-86400

    ce=(indexName.get()+niftyToken+"C"+event.widget["text"])

    pe=(indexName.get()+niftyToken+"P"+event.widget["text"])

    ret = api.searchscrip(exchange="NFO", searchtext=ce)

    if ret != None:

        symbols = ret['values']

    for symbol in symbols:

        ceToken=(symbol['token'])

        break

    ret = api.searchscrip(exchange="NFO", searchtext=pe)

    if ret != None:

        symbols = ret['values']

    for symbol in symbols:

        peToken=(symbol['token'])

        break  

    ret1 = api.get_time_price_series(exchange='NFO', token=ceToken, starttime=start_secs, endtime=end_time, interval=timeFrame.get())

    ret2 = api.get_time_price_series(exchange='NFO', token=peToken, starttime=start_secs, endtime=end_time, interval=timeFrame.get())

    length=len(ret1)

    print(length)

    if(length>9):

        length=9

    i=0

    Label(middleFrame,text="TIME",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=0)

    Label(middleFrame,text=event.widget["text"]+"CE",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=1)

    Label(middleFrame,text="STATUS",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=2)

    Label(middleFrame,text=event.widget["text"]+"PE",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=3)

    Label(middleFrame,text="STATUS",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=4)

    while(i<(length-1)):

        ceOi=float(ret1[i]["oi"])-float(ret1[i+1]["oi"])

        peOi=float(ret2[i]["oi"])-float(ret2[i+1]["oi"])

        ceLtp=float(ret1[i]["intc"])-float(ret1[i+1]["intc"])

        peLtp=float(ret2[i]["intc"])-float(ret2[i+1]["intc"])

        Label(middleFrame,text=ret1[i]["time"],bg="cadetblue1",font=("Arial bold",10)).grid(row=i+5,column=0)

        Label(middleFrame,text=ceOi,width=10,font=("Arial bold",10)).grid(row=i+5,column=1)

        if((ceOi>0)and(ceLtp>0)):

            Label(middleFrame,text="LONG BUILD",width=14,bg="chartreuse1",font=("Arial bold",10)).grid(row=i+5,column=2)

        elif((ceOi>0)and(ceLtp<0)):

            Label(middleFrame,text="SHORT BUILD",width=14,bg="red",font=("Arial bold",10)).grid(row=i+5,column=2)

        elif((ceOi<0)and(ceLtp>0)):

            Label(middleFrame,text="SHORT COVER",width=14,bg="aqua",font=("Arial bold",10)).grid(row=i+5,column=2)   

        elif((ceOi<0)and(ceLtp<0)):

            Label(middleFrame,text="LONG UNWIND",width=14,bg="gold1",font=("Arial bold",10)).grid(row=i+5,column=2) 

        Label(middleFrame,text=peOi,width=10,font=("Arial bold",10)).grid(row=i+5,column=3)

        if((peOi>0)and(peLtp>0)):

            Label(middleFrame,text="LONG BUILD",width=14,bg="chartreuse1",font=("Arial bold",10)).grid(row=i+5,column=4)

        elif((peOi>0)and(peLtp<0)):

            Label(middleFrame,text="SHORT BUILD",width=14,bg="red",font=("Arial bold",10)).grid(row=i+5,column=4)

        elif((peOi<0)and(peLtp>0)):

            Label(middleFrame,text="SHORT COVER",width=14,bg="aqua",font=("Arial bold",10)).grid(row=i+5,column=4)   

        elif((peOi<0)and(peLtp<0)):

            Label(middleFrame,text="LONG UNWIND",width=14,bg="gold1",font=("Arial bold",10)).grid(row=i+5,column=4)     

        i+=1

def futureOi():

    widgets= botFrame.winfo_children()

    for widget in widgets:

        widget.destroy()

    end_time = time.time()

    start_secs = end_time-86400

    ret1 = api.searchscrip(exchange="NFO", searchtext="NIFTY")

    ret2 = api.searchscrip(exchange="NFO", searchtext="BANKNIFTY")

    niftyFut=""

    bankNiftyFut=""

    if ret1 != None:

        symbols = ret1['values']

        for symbol in symbols:

            niftyFut=(symbol["token"])

            break

    if ret2 != None:

        symbols = ret2['values']

        for symbol in symbols:

            bankNiftyFut=(symbol["token"])

            break   

    

    ret1 = api.get_time_price_series(exchange='NFO', token=niftyFut, starttime=start_secs, endtime=end_time, interval=timeFrame.get())

    ret2 = api.get_time_price_series(exchange='NFO', token=bankNiftyFut, starttime=start_secs, endtime=end_time, interval=timeFrame.get())

    length=len(ret1)

    print(length)

    if(length>9):

        length=9

    i=0

    Label(botFrame,text="TIME",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=0)

    Label(botFrame,text="NIFTY FUT",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=1)

    Label(botFrame,text="STATUS",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=2)

    Label(botFrame,text="BANKNIFTY FUT",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=3)

    Label(botFrame,text="STATUS",width=14,bg="gray",font=("Arial Black",10)).grid(row=0,column=4)

    while(i<(length-1)):

        ceOi=float(ret1[i]["oi"])-float(ret1[i+1]["oi"])

        peOi=float(ret2[i]["oi"])-float(ret2[i+1]["oi"])

        ceLtp=float(ret1[i]["intc"])-float(ret1[i+1]["intc"])

        peLtp=float(ret2[i]["intc"])-float(ret2[i+1]["intc"])

        Label(botFrame,text=ret1[i]["time"],bg="cadetblue1",font=("Arial bold",10)).grid(row=i+5,column=0)

        Label(botFrame,text=ceOi,width=10,font=("Arial bold",10)).grid(row=i+5,column=1)

        if((ceOi>0)and(ceLtp>0)):

            Label(botFrame,text="LONG BUILD",width=14,bg="chartreuse1",font=("Arial bold",10)).grid(row=i+5,column=2)

        elif((ceOi>0)and(ceLtp<0)):

            Label(botFrame,text="SHORT BUILD",width=14,bg="red",font=("Arial bold",10)).grid(row=i+5,column=2)

        elif((ceOi<0)and(ceLtp>0)):

            Label(botFrame,text="SHORT COVER",width=14,bg="aqua",font=("Arial bold",10)).grid(row=i+5,column=2)   

        elif((ceOi<0)and(ceLtp<0)):

            Label(botFrame,text="LONG UNWIND",width=14,bg="gold1",font=("Arial bold",10)).grid(row=i+5,column=2) 

        Label(botFrame,text=peOi,width=10,font=("Arial bold",10)).grid(row=i+5,column=3)

        if((peOi>0)and(peLtp>0)):

            Label(botFrame,text="LONG BUILD",width=14,bg="chartreuse1",font=("Arial bold",10)).grid(row=i+5,column=4)

        elif((peOi>0)and(peLtp<0)):

            Label(botFrame,text="SHORT BUILD",width=14,bg="red",font=("Arial bold",10)).grid(row=i+5,column=4)

        elif((peOi<0)and(peLtp>0)):

            Label(botFrame,text="SHORT COVER",width=14,bg="aqua",font=("Arial bold",10)).grid(row=i+5,column=4)   

        elif((peOi<0)and(peLtp<0)):

            Label(botFrame,text="LONG UNWIND",width=14,bg="gold1",font=("Arial bold",10)).grid(row=i+5,column=4)     

        

        i+=1

def oiChange():

    global niftyTokens

    widgets= optionFrame.winfo_children()

    i=0

    end_time = time.time()

    start_secs = end_time-86400

    oiChange=0

    closeChange=0

    while(i<10):

        ret = api.get_time_price_series(exchange='NFO', token=niftyTokens[i*2], starttime=start_secs, endtime=end_time, interval=timeFrame.get())

        oiChange=int(ret[0]["oi"])-int(ret[1]["oi"])

        closeChange=float(ret[0]["intc"])-float(ret[1]["intc"])

        

        if((closeChange>0)and(oiChange>0)):

            widgets[7+(7*i)]["text"]="(L)"+str(oiChange)

            widgets[7+(7*i)].config(bg="chartreuse1")

        elif((closeChange<0)and(oiChange>0)):

            widgets[7+(7*i)]["text"]="(S)"+str(oiChange)

            widgets[7+(7*i)].config(bg="red")

        elif((closeChange>0)and(oiChange<0)):

            widgets[7+(7*i)]["text"]="(SC)"+str(oiChange)

            widgets[7+(7*i)].config(bg="aqua")

        elif((closeChange<0)and(oiChange<0)):

            widgets[7+(7*i)]["text"]="(LU)"+str(oiChange)

            widgets[7+(7*i)].config(bg="gold1")

        ret = api.get_time_price_series(exchange='NFO', token=niftyTokens[(i*2)+1], starttime=start_secs, endtime=end_time, interval=timeFrame.get())

        oiChange=int(ret[0]["oi"])-int(ret[1]["oi"])

        closeChange=float(ret[0]["intc"])-float(ret[1]["intc"])

        

        if((closeChange>0)and(oiChange>0)):

            widgets[7+(7*i)+6]["text"]="(L)"+str(oiChange)

            widgets[7+(7*i)+6].config(bg="chartreuse1")

        elif((closeChange<0)and(oiChange>0)):

            widgets[7+(7*i)+6]["text"]="(S)"+str(oiChange)

            widgets[7+(7*i)+6].config(bg="red")

        elif((closeChange>0)and(oiChange<0)):

            widgets[7+(7*i)+6]["text"]="(SC)"+str(oiChange)

            widgets[7+(7*i)+6].config(bg="aqua")

        elif((closeChange<0)and(oiChange<0)):

            widgets[7+(7*i)+6]["text"]="(LU)"+str(oiChange)

            widgets[7+(7*i)+6].config(bg="gold1")

        i+=1

topFrame=Frame(root)

Label(topFrame,text="INDEX").grid(row=0,column=0)

indexName=ttk.Combobox(topFrame,values=["NIFTY","BANKNIFTY"])

indexName.current(0)

indexName.grid(row=0,column=1)

Label(topFrame,text="TIMEFRAME").grid(row=0,column=2)

timeFrame=ttk.Combobox(topFrame,values=["3","5","10","15","30","60","120","180","240"])

timeFrame.current(1)

timeFrame.grid(row=0,column=3)

Button(topFrame,text="OPTION CHAIN",command=optionChain).grid(row=0,column=4)

Button(topFrame,text="OI CHANGE",command=lambda:startThread("oi")).grid(row=0,column=5)

Button(topFrame,text="FUTURE OI",command=lambda:startThread("future")).grid(row=0,column=6)

topFrame.pack()

optionFrame=Frame(root,highlightbackground="black", highlightthickness=2)

optionFrame.pack()

middleFrame=Frame(root,highlightbackground="black", highlightthickness=2)

middleFrame.pack()

botFrame=Frame(root,highlightbackground="black", highlightthickness=2)

botFrame.pack()

root.mainloop()