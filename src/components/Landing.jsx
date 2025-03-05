import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup, Card } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faUserCog, faUserPlus, faUsers, faSignInAlt, faShoppingCart, faExchangeAlt, faChartLine, faCalendarAlt, faDollarSign,
  faArrowRight, faSearch, faArrowLeft, faCheckCircle, faCheck, faEdit
} from '@fortawesome/free-solid-svg-icons';
import './css/landing.css';

const Landing = () => {
  const [users, setUsers] = useState([]);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [openTrades, setOpenTrades] = useState([]);
  const [showTradesDashboard, setShowTradesDashboard] = useState(false);
  const [formStep, setFormStep] = useState(1);
  const [activeTradeId, setActiveTradeId] = useState(null);
  const [optionChainData, setOptionChainData] = useState(null);
  const [marketData, setMarketData] = useState({ ltp: 0.0, volume: 0, oi: 0, timestamp: "" });
  const [ws, setWs] = useState(null);
  const [chartSymbol, setChartSymbol] = useState("NSE:BANKNIFTY");

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Shoonya",
    api_key: "",
    totp_token: "",
    vendor_code: "",
    default_quantity: 1,
    imei: "",
    symbol: "BANKNIFTY",
    expiry: "",
    strike_price: 47800,
    strike_count: 5,
    option_type: "Call",
    tradingsymbol: "",
    symboltoken: "",
    exchange: "NFO", // Default to NFO since your data is NFO-based
    buy_type: "Fixed",
    buy_threshold: 110,
    previous_close: 0,
    producttype: "INTRADAY",
    stop_loss_type: "Fixed",
    stop_loss_value: 5.0,
    points_condition: 0,
    sell_type: "Fixed",
    sell_threshold: 90
  });

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users");
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users.", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades");
      const data = await response.json();
      setOpenTrades(data.trades || []);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions.", type: "danger" });
    }
  };

  const fetchOptionChainOrMarketData = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select a user.", type: "warning" });
      return;
    }

    const username = selectedUsers[0];
    const user = users.find(u => u.username === username);
    if (!user) {
      setMessage({ text: "Selected user not found.", type: "warning" });
      return;
    }

    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_shoonya_option_chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          exchange: formData.exchange,
          symbol: formData.symbol,
          expiry_date: formData.expiry,
          strike_price: formData.strike_price,
          strike_count: formData.strike_count
        }),
      });

      const data = await response.json();
      if (response.ok) {
        if (formData.exchange === "NFO") {
          setOptionChainData(data.data);
          setChartSymbol(formatChartSymbol(formData.symbol, formData.exchange));
          setMessage({ text: `Option chain data fetched for ${formData.symbol}!`, type: "success" });
          setFormStep(3);
          startWebSocket(username, data.data.flatMap(item => [item.Call.Token, item.Put.Token].filter(Boolean)));
        } else {
          setMarketData(data.data[0] || {});
          setChartSymbol(formatChartSymbol(data.data[0]?.TradingSymbol || formData.symbol, formData.exchange));
          setMessage({ text: `Market data fetched for ${formData.symbol}!`, type: "info" });
          setFormStep(3.5);
          startWebSocket(username, [data.data[0]?.Token]);
        }
      } else {
        setMessage({ text: data.message || data.detail || "Failed to fetch data", type: "danger" });
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setMessage({ text: "Server error fetching data.", type: "danger" });
    }
  };

  const startWebSocket = (username, tokens) => {
    if (ws) ws.forEach(w => w.close());
    const newWs = tokens.map(token => {
      const wsUrl = new URL(`wss://mtb-8ra9.onrender.com/ws/option_chain/${username}/${token}`);
      const tokenWs = new WebSocket(wsUrl.href);
      tokenWs.onopen = () => console.log(`WebSocket opened for token: ${token}`);
      tokenWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(`WebSocket data for token ${token}:`, data);
        if (formData.exchange === "NFO") {
          setOptionChainData(prevData => prevData?.map(item => ({
            ...item,
            Call: item.Call.Token === token ? { ...item.Call, LTP: data.ltp, OI: data.oi, Volume: data.volume, timestamp: data.timestamp } : item.Call,
            Put: item.Put.Token === token ? { ...item.Put, LTP: data.ltp, OI: data.oi, Volume: data.volume, timestamp: data.timestamp } : item.Put
          })));
          if (formData.symboltoken === token) {
            setMarketData({
              ltp: data.ltp || 0.0,
              oi: data.oi || 0,
              volume: data.volume || 0,
              timestamp: data.timestamp || new Date().toISOString()
            });
          }
        } else {
          setMarketData(prev => ({
            ...prev,
            ltp: data.ltp || prev.ltp,
            oi: data.oi || prev.oi,
            volume: data.volume || prev.volume,
            timestamp: data.timestamp || prev.timestamp
          }));
        }
      };
      tokenWs.onerror = (error) => {
        console.error("WebSocket error for token", token, ":", error);
        setMessage({ text: `WebSocket failed for ${token}. Using polling.`, type: "warning" });
        pollMarketData(username, token);
      };
      tokenWs.onclose = () => console.log("WebSocket closed for token", token);
      return tokenWs;
    });
    setWs(newWs);
  };

  const pollMarketData = (username, token) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`https://mtb-8ra9.onrender.com/api/get_market_data/${username}/${token}`);
        if (response.ok) {
          const data = await response.json();
          console.log(`Polling data for token ${token}:`, data);
          if (formData.exchange === "NFO") {
            setOptionChainData(prevData => prevData?.map(item => ({
              ...item,
              Call: item.Call.Token === token ? { ...item.Call, LTP: data.ltp, OI: data.oi, Volume: data.market_data?.v, timestamp: data.market_data?.ft } : item.Call,
              Put: item.Put.Token === token ? { ...item.Put, LTP: data.ltp, OI: data.oi, Volume: data.market_data?.v, timestamp: data.market_data?.ft } : item.Put
            })));
            if (formData.symboltoken === token) {
              setMarketData({
                ltp: data.ltp || 0.0,
                oi: data.oi || 0,
                volume: data.market_data?.v || 0,
                timestamp: data.market_data?.ft || new Date().toISOString()
              });
            }
          } else {
            setMarketData({
              ltp: data.ltp,
              oi: data.oi,
              volume: data.market_data?.v || 0,
              timestamp: data.market_data?.ft || new Date().toISOString()
            });
          }
        }
      } catch (error) {
        console.error("Error polling market data for token", token, ":", error);
      }
    }, 2000);
    return () => clearInterval(pollInterval);
  };

  const handleSelectStrike = (strikeData) => {
    const isCall = strikeData.OptionType === "CE";
    const expiry = formData.expiry ? formData.expiry.replace(/-/g, "").slice(0, 6) : "27MAR25"; // Adjust based on your expiry format
    const assetName = `${formData.symbol}${expiry}${isCall ? "C" : "P"}${strikeData.StrikePrice}`;
    setFormData({
      ...formData,
      tradingsymbol: strikeData.TradingSymbol || assetName, // Use TradingSymbol if available, else construct it
      symboltoken: strikeData.Token,
      previous_close: parseFloat(strikeData.LTP) || 0,
      strike_price: parseInt(strikeData.StrikePrice, 10), // Ensure integer for display
      option_type: isCall ? "Call" : "Put"
    });
    setMarketData({
      ltp: parseFloat(strikeData.LTP) || 0.0,
      oi: parseFloat(strikeData.OI) || 0,
      volume: parseFloat(strikeData.Volume) || 0,
      timestamp: strikeData.timestamp || new Date().toISOString()
    });
    setChartSymbol(formatChartSymbol(strikeData.TradingSymbol || assetName, formData.exchange));
    setFormStep(3.5);
    startMarketUpdates(selectedUsers[0], strikeData.Token);
  };

  const handleConfirmTrade = () => {
    if (formStep === 3.5) {
      setFormStep(4);
    }
  };

  const startMarketUpdates = useCallback((username, symboltoken) => {
    if (ws) ws.forEach(w => w.close());
    const newWs = new WebSocket(`wss://mtb-8ra9.onrender.com/ws/option_chain/${username}/${symboltoken}`);
    setWs([newWs]);
    newWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Market update received:", data);
      setMarketData({
        ltp: data.ltp || 0.0,
        oi: data.oi || 0,
        volume: data.volume || 0,
        timestamp: data.timestamp || new Date().toISOString()
      });
    };
    newWs.onerror = (error) => {
      console.error("WebSocket error for market updates:", error);
      setMessage({ text: "WebSocket failed for updates. Polling instead.", type: "warning" });
      pollMarketData(username, symboltoken);
    };
    newWs.onclose = () => console.log("WebSocket closed for market updates.");
    return () => newWs.close();
  }, []);

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        username: formData.username,
        password: formData.password,
        broker: formData.broker,
        api_key: formData.api_key,
        totp_token: formData.totp_token,
        default_quantity: parseInt(formData.default_quantity || 1, 10),
        imei: formData.broker === "Shoonya" ? formData.imei : "trading_app"
      };
      if (formData.broker === "Shoonya") {
        payload.vendor_code = formData.vendor_code;
      }
      const response = await fetch("https://mtb-8ra9.onrender.com/api/register_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.ok) {
        setMessage({ text: data.message, type: "success" });
        fetchUsers();
        setFormData({ ...formData, username: "", password: "", api_key: "", totp_token: "", vendor_code: "", imei: "" });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: "Server error during registration.", type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Are you sure you want to delete ${username}?`)) return;
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, { method: "DELETE" });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: data.message, type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error deleting user.", type: "danger" });
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select a user.", type: "warning" });
      return;
    }

    try {
      const username = selectedUsers[0];
      const user = users.find(u => u.username === username);
      if (!user) throw new Error("User not found");

      const response = await fetch("https://mtb-8ra9.onrender.com/api/initiate_buy_trade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          tradingsymbol: formData.tradingsymbol,
          symboltoken: formData.symboltoken,
          exchange: formData.exchange,
          strike_price: formData.strike_price,
          buy_type: formData.buy_type,
          buy_threshold: formData.buy_threshold,
          previous_close: formData.previous_close,
          producttype: formData.producttype,
          stop_loss_type: formData.stop_loss_type,
          stop_loss_value: formData.stop_loss_value,
          points_condition: formData.points_condition,
          sell_type: formData.sell_type,
          sell_threshold: formData.sell_threshold
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: data.message, type: "success" });
        setActiveTradeId(data.position_id);
        fetchOpenPositions();
        setFormStep(1);
        setSelectedUsers([]);
      } else {
        setMessage({ text: data.detail || "Trade initiation failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade.", type: "danger" });
    }
  };

  const handleUpdateConditions = async () => {
    if (!activeTradeId || !selectedUsers.length) {
      setMessage({ text: "No active trade or user selected.", type: "warning" });
      return;
    }

    try {
      const username = selectedUsers[0];
      const response = await fetch("https://mtb-8ra9.onrender.com/api/update_trade_conditions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          position_id: activeTradeId,
          stop_loss_type: formData.stop_loss_type,
          stop_loss_value: formData.stop_loss_value,
          points_condition: formData.points_condition,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: data.message, type: "success" });
        fetchOpenPositions();
      } else {
        setMessage({ text: data.detail || "Failed to update conditions", type: "danger" });
      }
    } catch (error) {
      console.error("Error updating conditions:", error);
      setMessage({ text: "Server error updating conditions.", type: "danger" });
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup}>
      <Dropdown.Toggle variant="outline-dark" id="dropdown-basic" className="rounded-pill">
        <FontAwesomeIcon icon={faUserCog} /> User Actions
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register User
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }}>
          <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.shoonya.com/login', '_blank')}>
          <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Shoonya Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const formatChartSymbol = (symbol, exchange) => {
    const cleanSymbol = symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return `${exchange}:${cleanSymbol}`;
  };

  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
    return () => { if (ws) ws.forEach(w => w.close()); };
  }, []);

  return (
    <Container fluid className="p-4" style={{ minHeight: "100vh", background: "linear-gradient(135deg, #e6f0fa 0%, #d1e0e8 100%)" }}>
      <Row className="mb-4">
        <Col>
          {message.text && (
            <Alert variant={message.type} dismissible onClose={() => setMessage({ text: "", type: "" })} style={{ borderRadius: "10px", boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
              {message.text}
            </Alert>
          )}
        </Col>
      </Row>

      <Row className="g-4">
        <Col md={6}>
          <Card className="shadow-sm" style={{ borderRadius: "15px", overflow: "hidden" }}>
            <Card.Body className="p-0">
              <div style={{ height: "500px" }}>
                <TradingViewWidget symbol={chartSymbol} />
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Row className="mb-3 justify-content-end">
            <Col xs="auto">
              <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
            </Col>
          </Row>

          {showUsers && (
            <Card className="mb-4 shadow-sm" style={{ borderRadius: "15px" }}>
              <Card.Header className="bg-dark text-white">Registered Users</Card.Header>
              <Card.Body>
                <Table striped hover responsive>
                  <thead>
                    <tr>
                      <th>#</th><th>Username</th><th>Broker</th><th>Qty</th><th>Vendor</th><th>IMEI</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{user.username}</td>
                        <td>{user.broker}</td>
                        <td>{user.default_quantity}</td>
                        <td>{user.vendor_code || "N/A"}</td>
                        <td>{user.imei || "N/A"}</td>
                        <td><Button variant="outline-danger" size="sm" onClick={() => handleDeleteUser(user.username)}>Delete</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}

          {showTradesDashboard && (
            <Card className="mb-4 shadow-sm" style={{ borderRadius: "15px" }}>
              <Card.Header className="bg-dark text-white">Active Trades</Card.Header>
              <Card.Body>
                <Table striped hover responsive>
                  <thead>
                    <tr>
                      <th>#</th><th>User</th><th>Symbol</th><th>Entry</th><th>Buy</th><th>SL Type</th><th>SL Value</th><th>Sell</th><th>Broker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map((trade, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{trade.username}</td>
                        <td>{trade.symbol}</td>
                        <td>₹{trade.entry_price.toFixed(2)}</td>
                        <td>₹{trade.buy_threshold.toFixed(2)}</td>
                        <td>{trade.stop_loss_type}</td>
                        <td>{trade.stop_loss_value}</td>
                        <td>₹{trade.sell_threshold?.toFixed(2) || "N/A"}</td>
                        <td>{users.find(u => u.username === trade.username)?.broker}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}

          <Row className="mb-3 justify-content-center">
            <Col xs="auto">
              <Button variant="outline-info" onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }}>
                <FontAwesomeIcon icon={faExchangeAlt} /> Toggle Trades
              </Button>
            </Col>
          </Row>

          <Card className="shadow-sm p-4" style={{ borderRadius: "15px" }}>
            <Card.Body>
              {formStep === 1 && (
                <div>
                  <h5>Select User</h5>
                  <Form>
                    {users.map((user, index) => (
                      <Form.Check
                        key={index}
                        type="radio"
                        label={user.username}
                        checked={selectedUsers[0] === user.username}
                        onChange={() => setSelectedUsers([user.username])}
                        className="mb-2"
                      />
                    ))}
                    <Button variant="primary" onClick={() => selectedUsers.length ? setFormStep(2) : setMessage({ text: "Select a user.", type: "warning" })}>
                      <FontAwesomeIcon icon={faArrowRight} /> Next
                    </Button>
                  </Form>
                </div>
              )}

              {formStep === 2 && (
                <div>
                  <h5>Market/Option Data</h5>
                  <Form>
                    <Row className="mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Symbol</Form.Label>
                          <Form.Control
                            type="text"
                            value={formData.symbol}
                            onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Exchange</Form.Label>
                          <Form.Select value={formData.exchange} onChange={(e) => setFormData({ ...formData, exchange: e.target.value })}>
                            <option value="NFO">NFO</option>
                            <option value="NSE">NSE</option>
                            <option value="BSE">BSE</option>
                            <option value="MCX">MCX</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col>
                        <Form.Group>
                          <Form.Label>Expiry (DD-MM-YYYY)</Form.Label>
                          <Form.Control
                            type="text"
                            value={formData.expiry}
                            onChange={(e) => setFormData({ ...formData, expiry: e.target.value })}
                            placeholder="e.g., 27-03-2025"
                            required={formData.exchange === "NFO"}
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                    {formData.exchange === "NFO" && (
                      <Row className="mb-3">
                        <Col md={6}>
                          <Form.Group>
                            <Form.Label>Strike Price</Form.Label>
                            <Form.Control
                              type="number"
                              value={formData.strike_price}
                              onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })}
                            />
                          </Form.Group>
                        </Col>
                        <Col md={6}>
                          <Form.Group>
                            <Form.Label>Strike Count</Form.Label>
                            <Form.Control
                              type="number"
                              value={formData.strike_count}
                              onChange={(e) => setFormData({ ...formData, strike_count: parseInt(e.target.value) || 5 })}
                            />
                          </Form.Group>
                        </Col>
                      </Row>
                    )}
                    <Button variant="primary" onClick={fetchOptionChainOrMarketData}>
                      <FontAwesomeIcon icon={faSearch} /> Fetch
                    </Button>
                    <Button variant="outline-secondary" className="ms-2" onClick={() => setFormStep(1)}>
                      <FontAwesomeIcon icon={faArrowLeft} /> Back
                    </Button>
                  </Form>
                </div>
              )}

              {formStep === 3 && optionChainData && (
                <div>
                  <h5>Select Option</h5>
                  <Table striped hover responsive>
                    <thead>
                      <tr>
                        <th>Strike</th><th>Call LTP</th><th>Call OI</th><th>Put LTP</th><th>Put OI</th><th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionChainData.map((item, index) => (
                        <tr key={index}>
                          <td>{item.StrikePrice}</td>
                          <td>{item.Call.LTP?.toFixed(2) || 'N/A'}</td>
                          <td>{item.Call.OI?.toFixed(2) || 'N/A'}</td>
                          <td>{item.Put.LTP?.toFixed(2) || 'N/A'}</td>
                          <td>{item.Put.OI?.toFixed(2) || 'N/A'}</td>
                          <td>
                            <ButtonGroup>
                              <Button variant="outline-primary" size="sm" onClick={() => handleSelectStrike({ ...item.Call, StrikePrice: item.StrikePrice, OptionType: "CE" })}>
                                Call
                              </Button>
                              <Button variant="outline-secondary" size="sm" onClick={() => handleSelectStrike({ ...item.Put, StrikePrice: item.StrikePrice, OptionType: "PE" })}>
                                Put
                              </Button>
                            </ButtonGroup>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <Button variant="outline-secondary" onClick={() => { setFormStep(2); setOptionChainData(null); if (ws) ws.forEach(w => w.close()); }}>
                    <FontAwesomeIcon icon={faArrowLeft} /> Back
                  </Button>
                </div>
              )}

              {formStep === 3.5 && (
                <div>
                  <h5>Confirm Selection</h5>
                  <Card className="mb-3 p-3">
                    <p><strong>Asset:</strong> {formData.tradingsymbol}</p>
                    <p><strong>Exchange:</strong> {formData.exchange}</p>
                    {formData.exchange === "NFO" && (
                      <>
                        <p><strong>Type:</strong> {formData.option_type}</p>
                        <p><strong>Strike:</strong> {formData.strike_price}</p> {/* Displays as 49200 */}
                      </>
                    )}
                    <p><strong>LTP:</strong> ₹{marketData.ltp.toFixed(2) || '0.00'}</p> {/* Ensures LTP updates */}
                  </Card>
                  <Button variant="success" onClick={handleConfirmTrade}>
                    <FontAwesomeIcon icon={faCheck} /> Confirm
                  </Button>
                  <Button variant="outline-secondary" className="ms-2" onClick={() => setFormStep(formData.exchange === "NFO" ? 3 : 2)}>
                    <FontAwesomeIcon icon={faArrowLeft} /> Back
                  </Button>
                </div>
              )}

              {formStep === 4 && (
                <div>
                  <h5>Trade Conditions</h5>
                  <p><strong>Live:</strong> LTP: ₹{marketData.ltp.toFixed(2) || '0.00'}, OI: {marketData.oi}, Vol: {marketData.volume}</p>
                  <Form>
                    <Row className="mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Buy Type</Form.Label>
                          <Form.Select value={formData.buy_type} onChange={(e) => setFormData({ ...formData, buy_type: e.target.value })}>
                            <option value="Fixed">Fixed</option>
                            <option value="Percentage">Percentage</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Buy Threshold</Form.Label>
                          <Form.Control type="number" value={formData.buy_threshold} onChange={(e) => setFormData({ ...formData, buy_threshold: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Prev Close</Form.Label>
                          <Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Product Type</Form.Label>
                          <Form.Select value={formData.producttype} onChange={(e) => setFormData({ ...formData, producttype: e.target.value })}>
                            <option value="INTRADAY">Intraday</option>
                            <option value="C">CNC</option>
                            <option value="M">NRML</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>SL Type</Form.Label>
                          <Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}>
                            <option value="Fixed">Fixed</option>
                            <option value="Percentage">Percentage</option>
                            <option value="Points">Points</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>SL Value</Form.Label>
                          <Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Points</Form.Label>
                          <Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Sell Type</Form.Label>
                          <Form.Select value={formData.sell_type} onChange={(e) => setFormData({ ...formData, sell_type: e.target.value })}>
                            <option value="Fixed">Fixed</option>
                            <option value="Percentage">Percentage</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Sell Threshold</Form.Label>
                          <Form.Control type="number" value={formData.sell_threshold} onChange={(e) => setFormData({ ...formData, sell_threshold: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Button variant="success" onClick={handleInitiateTrade}>
                      <FontAwesomeIcon icon={faCheck} /> Execute
                    </Button>
                    <Button variant="outline-secondary" className="ms-2" onClick={() => setFormStep(3.5)}>
                      <FontAwesomeIcon icon={faArrowLeft} /> Back
                    </Button>
                  </Form>
                </div>
              )}

              {activeTradeId && (
                <div className="mt-4">
                  <h5>Update Conditions</h5>
                  <Form>
                    <Row className="mb-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>SL Type</Form.Label>
                          <Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}>
                            <option value="Fixed">Fixed</option>
                            <option value="Percentage">Percentage</option>
                            <option value="Points">Points</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>SL Value</Form.Label>
                          <Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Points</Form.Label>
                          <Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Button variant="warning" onClick={handleUpdateConditions}>
                      <FontAwesomeIcon icon={faEdit} /> Update
                    </Button>
                  </Form>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)} centered>
        <Modal.Header closeButton className="bg-dark text-white">
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Broker</Form.Label>
              <Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })}>
                <option value="Shoonya">Shoonya</option>
                <option value="AngelOne">AngelOne</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>API Key</Form.Label>
              <Form.Control type="text" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control type="text" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required />
            </Form.Group>
            {formData.broker === "Shoonya" && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Vendor Code</Form.Label>
                  <Form.Control type="text" value={formData.vendor_code} onChange={(e) => setFormData({ ...formData, vendor_code: e.target.value })} required />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>IMEI</Form.Label>
                  <Form.Control type="text" value={formData.imei} onChange={(e) => setFormData({ ...formData, imei: e.target.value })} required />
                </Form.Group>
              </>
            )}
            <Form.Group className="mb-3">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control type="number" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required />
            </Form.Group>
            <Button variant="primary" type="submit">
              <FontAwesomeIcon icon={faUserPlus} /> Register
            </Button>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

const TradingViewWidget = memo(({ symbol }) => {
  const container = useRef();

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol || "NSE:BANKNIFTY",
      interval: "5",
      timezone: "Asia/Kolkata",
      theme: "light",
      style: "1",
      locale: "en",
      allow_symbol_change: true,
      calendar: false,
      support_host: "https://www.tradingview.com"
    });
    container.current.innerHTML = "";
    container.current.appendChild(script);
  }, [symbol]);

  return (
    <div className="tradingview-widget-container" ref={container} style={{ height: "100%", width: "100%" }}>
      <div className="tradingview-widget-container__widget" style={{ height: "calc(100% - 32px)", width: "100%" }}></div>
    </div>
  );
});

export default Landing;