import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup, Card } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserCog, faUserPlus, faUsers, faSignInAlt, faShoppingCart, faExchangeAlt, faChartLine, faCalendarAlt, faDollarSign, faArrowRight, faSearch, faArrowLeft, faCheckCircle, faCheck, faEdit } from '@fortawesome/free-solid-svg-icons';
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
    exchange: "NSE",
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
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades");
      const data = await response.json();
      setOpenTrades(data.trades || []);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const fetchOptionChainOrMarketData = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one Shoonya user.", type: "warning" });
      return;
    }

    const username = selectedUsers[0];
    const user = users.find(u => u.username === username);
    if (user.broker !== "Shoonya") {
      setMessage({ text: "Option chain/market data is only available for Shoonya users.", type: "warning" });
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
          setMessage({ text: `Option chain data fetched for ${formData.symbol} with expiry ${formData.expiry} on NFO!`, type: "success" });
          setFormStep(3);
          startWebSocket(username, data.data.map(item => item.Token));
        } else {  // MCX, NSE, BSE
          setMarketData(data.data[0] || {});
          setChartSymbol(formatChartSymbol(formData.symbol, formData.exchange));
          setMessage({ text: `Market data fetched for ${formData.symbol} on ${formData.exchange}! (No options available)`, type: "info" });
          setFormStep(4);
          startWebSocket(username, [data.data[0].Token]);
        }
      } else {
        setMessage({ text: data.detail || "Failed to fetch data", type: "danger" });
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      setMessage({ text: "Server error fetching data.", type: "danger" });
    }
  };

  const startWebSocket = (username, tokens) => {
    if (ws) ws.forEach(w => w.close());
    const newWs = [];
    tokens.forEach(token => {
      const wsUrl = new URL(`wss://mtb-8ra9.onrender.com/ws/option_chain/${username}/${token}`);
      const tokenWs = new WebSocket(wsUrl.href);
      newWs.push(tokenWs);
      tokenWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (formData.exchange === "NFO") {
          setOptionChainData(prevData => prevData?.map(item => 
            item.Token === token ? { ...item, LTP: data.ltp, OI: data.oi, Volume: data.volume, timestamp: data.timestamp } : item
          ));
        } else {
          setMarketData(prev => ({
            ...prev,
            ltp: data.ltp || 0.0,
            oi: data.oi || 0,
            volume: data.volume || 0,
            timestamp: data.timestamp || new Date().toISOString()
          }));
        }
      };
      tokenWs.onerror = (error) => {
        console.error("WebSocket error for token", token, ":", error);
        setMessage({ text: "WebSocket connection failed for real-time data. Falling back to polling.", type: "warning" });
        pollMarketData(username, token);
      };
      tokenWs.onclose = () => {
        console.log("WebSocket closed for token", token, ". Attempting to reconnect...");
        startWebSocket(username, tokens);
      };
    });
    setWs(newWs);
  };

  const pollMarketData = (username, token) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`https://mtb-8ra9.onrender.com/api/get_market_data/${username}/${token}`);
        if (response.ok) {
          const data = await response.json();
          if (formData.exchange === "NFO") {
            setOptionChainData(prevData => prevData?.map(item => 
              item.Token === token ? { ...item, LTP: data.ltp, OI: data.oi, Volume: data.volume, timestamp: data.market_data?.ft || new Date().toISOString() } : item
            ));
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
        setMessage({ text: "Failed to fetch real-time market data.", type: "danger" });
      }
    }, 1000);
    return () => clearInterval(pollInterval);
  };

  const handleSelectStrike = (strikeData) => {
    if (formData.exchange === "NFO") {
      setFormData({
        ...formData,
        tradingsymbol: strikeData.TradingSymbol,
        symboltoken: strikeData.Token,
        previous_close: parseFloat(strikeData.LTP),
        strike_price: parseFloat(strikeData.StrikePrice),
        option_type: strikeData.OptionType === "CE" ? "Call" : "Put"
      });
      setChartSymbol(formatChartSymbol(strikeData.TradingSymbol, formData.exchange));
      setFormStep(3.5); // Confirmation step for NFO
    } else {
      setMessage({ text: "Options selection is only available for NFO. Moving to trade conditions.", type: "warning" });
      setFormStep(4);
    }
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
      setMarketData({
        ltp: data.ltp || 0.0,
        oi: data.oi || 0,
        volume: data.volume || 0,
        timestamp: data.timestamp || new Date().toISOString()
      });
    };
    newWs.onerror = (error) => {
      console.error("WebSocket error for market updates:", error);
      setMessage({ text: "WebSocket connection failed for market updates. Falling back to polling.", type: "warning" });
      pollMarketData(username, symboltoken);
    };
    newWs.onclose = () => {
      console.log("WebSocket closed for market updates. Attempting to reconnect...");
      startMarketUpdates(username, symboltoken);
    };
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
        imei: formData.imei
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
        setMessage({ text: `User ${formData.username} registered successfully (${formData.broker})!`, type: "success" });
        fetchUsers();
        setFormData({ ...formData, username: "", password: "", api_key: "", totp_token: "", vendor_code: "", imei: "" });
        setShowRegisterModal(false);
      } else {
        setMessage({ text: data.detail || "Registration failed", type: "danger" });
      }
    } catch (error) {
      console.error("Error registering user:", error);
      setMessage({ text: `Server error registering ${formData.broker} user. Try again later.`, type: "danger" });
    }
  };

  const handleDeleteUser = async (username) => {
    try {
      const response = await fetch(`https://mtb-8ra9.onrender.com/api/delete_user/${username}`, { method: "DELETE" });
      const data = await response.json();
      if (response.ok) {
        setUsers(users.filter(user => user.username !== username));
        setMessage({ text: "User deleted successfully!", type: "success" });
      } else {
        setMessage({ text: data.detail || "Failed to delete user", type: "danger" });
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      setMessage({ text: "Server error. Try again later.", type: "danger" });
    }
  };

  const handleInitiateTrade = async () => {
    if (!selectedUsers.length) {
      setMessage({ text: "Please select at least one user.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

        const adjustedProductType = user.broker === "Shoonya" && formData.producttype === "INTRADAY" ? "I" : formData.producttype;

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
            producttype: adjustedProductType,
            stop_loss_type: formData.stop_loss_type,
            stop_loss_value: formData.stop_loss_value,
            points_condition: formData.points_condition,
            sell_type: formData.sell_type,
            sell_threshold: formData.sell_threshold
          }),
        });

        const data = await response.json();
        if (response.ok) {
          setMessage({ text: `Buy trade initiated for ${username} (${user.broker})! Position ID: ${data.position_id}`, type: "success" });
          setActiveTradeId(data.position_id);
          fetchOpenPositions();
        } else {
          setMessage({ text: `Failed for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade.", type: "danger" });
    }
    setFormStep(1);
    setSelectedUsers([]);
  };

  const handleUpdateConditions = async () => {
    if (!activeTradeId || !selectedUsers.length) {
      setMessage({ text: "No active trade or users selected for update.", type: "warning" });
      return;
    }

    try {
      for (const username of selectedUsers) {
        const user = users.find(u => u.username === username);
        if (!user) continue;

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
          setMessage({ text: `Conditions updated for ${username} (${user.broker})!`, type: "success" });
        } else {
          setMessage({ text: `Failed to update for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
        }
      }
    } catch (error) {
      console.error("Error updating conditions:", error);
      setMessage({ text: "Server error updating conditions.", type: "danger" });
    }
  };

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup} className="shadow-sm">
      <Dropdown.Toggle variant="primary" id="dropdown-basic" className="user-actions-dropdown">
        <FontAwesomeIcon icon={faUserCog} /> Manage Users
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)} className="text-dark">
          <FontAwesomeIcon icon={faUserPlus} className="me-2 text-primary" /> Register User
        </Dropdown.Item>
        <Dropdown.Item onClick={() => { setShowUsers(!showUsers); fetchUsers(); }} className="text-dark">
          <FontAwesomeIcon icon={faUsers} className="me-2 text-primary" /> View Users
        </Dropdown.Item>
        <Dropdown.Item onClick={() => window.open('https://www.shoonya.com/login', '_blank')} className="text-dark">
          <FontAwesomeIcon icon={faSignInAlt} className="me-2 text-primary" /> Shoonya Login
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );

  const formatChartSymbol = (symbol, exchange) => {
    const cleanSymbol = symbol.replace(" ", "").toUpperCase();
    if (exchange === "NFO") return `NFO:${cleanSymbol}`;
    else if (exchange === "MCX") return `MCX:${cleanSymbol}`;
    else if (exchange === "NSE") return `NSE:${cleanSymbol}`;
    else if (exchange === "BSE") return `BSE:${cleanSymbol}`;
    return `NSE:${cleanSymbol}`;
  };

  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
    return () => { if (ws) ws.forEach(w => w.close()); };
  }, []);

  return (
    <Container fluid className="p-4 bg-light" style={{ minHeight: "100vh" }}>
      <Row className="justify-content-center">
        <Col md={12} className="mb-4">
          <h1 className="text-center text-primary fw-bold mb-4">Shoonya Trading Platform</h1>
          {message.text && (
            <Alert variant={message.type === "success" ? "success" : "danger"} className="mb-3" style={{ borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
              {message.text}
            </Alert>
          )}
        </Col>
      </Row>

      <Row className="g-4">
        <Col md={6} className="mb-4">
          <Card className="h-100 shadow-sm border-0" style={{ borderRadius: "8px" }}>
            <Card.Body>
              <h4 className="text-primary mb-3"><FontAwesomeIcon icon={faChartLine} /> Market Chart</h4>
              <div style={{ height: "500px", border: "1px solid #dee2e6", borderRadius: "5px" }}>
                <TradingViewWidget symbol={chartSymbol} />
              </div>
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Row className="justify-content-end mb-3">
            <Col xs="auto">
              <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
            </Col>
          </Row>

          {showUsers && (
            <Card className="mb-4 shadow-sm border-0" style={{ borderRadius: "8px" }}>
              <Card.Body>
                <h3 className="text-center text-primary mb-3"><FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users</h3>
                <Table striped bordered hover responsive className="table-hover table-sm">
                  <thead className="bg-primary text-white">
                    <tr>
                      <th>#</th><th>Username</th><th>Broker</th><th>Default Qty</th><th>Vendor Code</th><th>IMEI</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length > 0 ? (
                      users.map((user, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{user.username}</td>
                          <td>{user.broker}</td>
                          <td>{user.default_quantity}</td>
                          <td>{user.broker === "Shoonya" ? user.vendor_code || "N/A" : "N/A"}</td>
                          <td>{user.broker === "Shoonya" ? user.imei || "N/A" : "N/A"}</td>
                          <td><Button variant="danger" size="sm" className="rounded-pill" onClick={() => handleDeleteUser(user.username)}>Delete</Button></td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="7" className="text-muted text-center">No registered users found.</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}

          {showTradesDashboard && (
            <Card className="mb-4 shadow-sm border-0" style={{ borderRadius: "8px" }}>
              <Card.Body>
                <h3 className="text-center text-dark fw-bold mb-3"><FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades</h3>
                <Table striped bordered hover responsive className="table-hover table-sm">
                  <thead className="bg-dark text-white">
                    <tr>
                      <th>#</th><th>Username</th><th>Symbol</th><th>Entry Price</th><th>Buy Threshold</th><th>Stop-Loss Type</th><th>Stop-Loss Value</th><th>Sell Threshold</th><th>Position</th><th>Broker</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.length > 0 ? (
                      openTrades.map((trade, index) => (
                        <tr key={index}>
                          <td>{index + 1}</td>
                          <td>{trade.username}</td>
                          <td>{trade.symbol}</td>
                          <td style={{ color: "green" }}>₹{trade.entry_price}</td>
                          <td>₹{trade.buy_threshold}</td>
                          <td>{trade.stop_loss_type}</td>
                          <td>{trade.stop_loss_value}</td>
                          <td style={{ color: "red" }}>₹{trade.sell_threshold || "N/A"}</td>
                          <td><span className="badge bg-success rounded-pill">Buy</span></td>
                          <td>{users.find(u => u.username === trade.username)?.broker || "Unknown"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="10" className="text-muted text-center">No active trades found.</td></tr>
                    )}
                  </tbody>
                </Table>
              </Card.Body>
            </Card>
          )}

          <Row className="justify-content-center mb-3">
            <Col xs="auto">
              <Button variant="outline-primary" className="rounded-pill" onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }}>
                <FontAwesomeIcon icon={faExchangeAlt} className="me-2" /> Trades Dashboard
              </Button>
            </Col>
          </Row>

          <Card className="shadow-sm border-0 p-4" style={{ borderRadius: "8px", backgroundColor: "#ffffff" }}>
            <Card.Body>
              {formStep === 1 && (
                <div className="fade-in">
                  <h4 className="text-primary mb-3"><FontAwesomeIcon icon={faUsers} /> Step 1: Select Shoonya User</h4>
                  <Form>
                    <Row className="mb-3">
                      <Col>
                        {users.filter(user => user.broker === "Shoonya").map((user, index) => (
                          <Form.Check
                            key={index}
                            type="checkbox"
                            label={user.username}
                            checked={selectedUsers.includes(user.username)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                if (selectedUsers.length < 1) setSelectedUsers([user.username]);
                                else alert("⚠ You can only select 1 Shoonya user for trading.");
                              } else {
                                setSelectedUsers([]);
                              }
                            }}
                            className="mb-2"
                          />
                        ))}
                      </Col>
                    </Row>
                    <Button variant="primary" className="rounded-pill" onClick={() => { if (selectedUsers.length) setFormStep(2); else alert("Select 1 Shoonya user."); }}>
                      <FontAwesomeIcon icon={faArrowRight} className="me-2" /> Next
                    </Button>
                  </Form>
                </div>
              )}

              {formStep === 2 && (
                <div className="fade-in">
                  <h4 className="text-primary mb-3"><FontAwesomeIcon icon={faChartLine} /> Step 2: Enter Market/Option Data</h4>
                  <Form>
                    <Row className="mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Symbol (e.g., BANKNIFTY, GOLD, RELIANCE, NIFTY27MAR14500CE)</Form.Label>
                          <Form.Control
                            type="text"
                            placeholder="e.g., BANKNIFTY, GOLD, RELIANCE, NIFTY27MAR14500CE"
                            value={formData.symbol}
                            onChange={(e) => {
                              const newSymbol = e.target.value || "BANKNIFTY";
                              setFormData({ ...formData, symbol: newSymbol });
                              setChartSymbol(formatChartSymbol(newSymbol, formData.exchange));
                            }}
                            className="rounded"
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Exchange (Default: NSE)</Form.Label>
                          <Form.Select
                            value={formData.exchange}
                            onChange={(e) => {
                              const newExchange = e.target.value;
                              setFormData({ ...formData, exchange: newExchange });
                              setChartSymbol(formatChartSymbol(formData.symbol, newExchange));
                            }}
                            className="rounded"
                          >
                            <option value="NFO">NFO (Nifty Futures & Options)</option>
                            <option value="NSE">NSE (National Stock Exchange)</option>
                            <option value="BSE">BSE (Bombay Stock Exchange)</option>
                            <option value="MCX">MCX (Multi Commodity Exchange)</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3">
                      <Col md={6}>
                        <Form.Group>
                          <Form.Label>Expiry Date (DD-MM-YYYY, required for NFO, optional for others)</Form.Label>
                          <Form.Control
                            type="text"
                            placeholder="e.g., 27-03-2025"
                            value={formData.expiry}
                            onChange={(e) => setFormData({ ...formData, expiry: e.target.value })}
                            required={formData.exchange === "NFO"}
                            className="rounded"
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                    {formData.exchange === "NFO" && (
                      <Row className="mb-3">
                        <Col md={6}>
                          <Form.Group>
                            <Form.Label>Strike Price (for NFO only)</Form.Label>
                            <Form.Control
                              type="number"
                              value={formData.strike_price}
                              onChange={(e) => setFormData({ ...formData, strike_price: parseFloat(e.target.value) || 0 })}
                              required
                              className="rounded"
                            />
                          </Form.Group>
                        </Col>
                        <Col md={6}>
                          <Form.Group>
                            <Form.Label>Number of Strikes (for NFO only)</Form.Label>
                            <Form.Control
                              type="number"
                              value={formData.strike_count}
                              onChange={(e) => setFormData({ ...formData, strike_count: parseInt(e.target.value) || 5 })}
                              min="1"
                              required
                              className="rounded"
                            />
                          </Form.Group>
                        </Col>
                      </Row>
                    )}
                    <div className="d-flex gap-2">
                      <Button variant="primary" className="rounded-pill" onClick={fetchOptionChainOrMarketData}>
                        <FontAwesomeIcon icon={faSearch} className="me-2" /> Fetch Data
                      </Button>
                      <Button variant="secondary" className="rounded-pill" onClick={() => { setFormStep(1); setSelectedUsers([]); }}>
                        <FontAwesomeIcon icon={faArrowLeft} className="me-2" /> Back
                      </Button>
                    </div>
                  </Form>
                </div>
              )}

              {formData.exchange === "NFO" && formStep === 3 && optionChainData && (
                <div className="fade-in">
                  <h4 className="text-success mb-3"><FontAwesomeIcon icon={faChartLine} /> Step 3: {formData.symbol} Option Chain</h4>
                  <Table striped bordered hover responsive className="option-chain-table table-hover table-sm" style={{ fontSize: '14px', backgroundColor: '#ffffff', borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                    <thead className="bg-primary text-white">
                      <tr>
                        <th style={{ width: '10%' }}>Strike Price</th>
                        <th colSpan="4" style={{ textAlign: 'center', width: '45%' }}>Call</th>
                        <th colSpan="4" style={{ textAlign: 'center', width: '45%' }}>Put</th>
                      </tr>
                      <tr>
                        <th></th><th>LTP</th><th>Bid</th><th>Ask</th><th>OI (Lakhs)</th><th>LTP</th><th>Bid</th><th>Ask</th><th>OI (Lakhs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {optionChainData.map((item, index) => (
                        <tr key={index} style={{ backgroundColor: index % 2 === 0 ? '#f8f9fa' : '#ffffff' }}>
                          <td style={{ fontWeight: 'bold', color: '#007bff' }}>{item.StrikePrice.toFixed(2)}</td>
                          <td style={{ color: item.Call.LTP >= 0 ? '#28a745' : '#dc3545' }}>{item.Call.LTP ? item.Call.LTP.toFixed(2) : "N/A"}</td>
                          <td>{item.Call.Bid ? item.Call.Bid.toFixed(2) : "N/A"}</td>
                          <td>{item.Call.Ask ? item.Call.Ask.toFixed(2) : "N/A"}</td>
                          <td>{item.Call.OI ? item.Call.OI.toFixed(2) : "N/A"}</td>
                          <td style={{ color: item.Put.LTP >= 0 ? '#28a745' : '#dc3545' }}>{item.Put.LTP ? item.Put.LTP.toFixed(2) : "N/A"}</td>
                          <td>{item.Put.Bid ? item.Put.Bid.toFixed(2) : "N/A"}</td>
                          <td>{item.Put.Ask ? item.Put.Ask.toFixed(2) : "N/A"}</td>
                          <td>{item.Put.OI ? item.Put.OI.toFixed(2) : "N/A"}</td>
                          <td>
                            <ButtonGroup>
                              {item.Call.TradingSymbol && (
                                <Button variant="primary" size="sm" className="rounded-pill" onClick={() => handleSelectStrike({ ...item.Call, StrikePrice: item.StrikePrice, OptionType: "CE" })}>
                                  Select Call
                                </Button>
                              )}
                              {item.Put.TradingSymbol && (
                                <Button variant="secondary" size="sm" className="rounded-pill ms-2" onClick={() => handleSelectStrike({ ...item.Put, StrikePrice: item.StrikePrice, OptionType: "PE" })}>
                                  Select Put
                                </Button>
                              )}
                            </ButtonGroup>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="mt-3 d-flex gap-2">
                    <Button variant="secondary" className="rounded-pill" onClick={() => { setFormStep(2); if (ws) ws.forEach(w => w.close()); setOptionChainData(null); }}>
                      <FontAwesomeIcon icon={faArrowLeft} className="me-2" /> Back
                    </Button>
                  </div>
                </div>
              )}

              {formData.exchange === "NFO" && formStep === 3.5 && (
                <div className="fade-in">
                  <h4 className="text-info mb-3"><FontAwesomeIcon icon={faCheckCircle} /> Step 3.5: Confirm Option Selection</h4>
                  <Card className="mb-3 p-3 shadow-sm" style={{ borderRadius: "8px", backgroundColor: "#f8f9fa" }}>
                    <p><strong>Selected Option:</strong> {formData.tradingsymbol} ({formData.option_type})</p>
                    <p><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                    <p><strong>Previous Close:</strong> ₹{formData.previous_close.toFixed(2)}</p>
                    <p><strong>Exchange:</strong> {formData.exchange}</p>
                  </Card>
                  <div className="d-flex gap-2">
                    <Button variant="success" className="rounded-pill" onClick={handleConfirmTrade}>
                      <FontAwesomeIcon icon={faCheck} className="me-2" /> Confirm & Proceed to Trade
                    </Button>
                    <Button variant="secondary" className="rounded-pill" onClick={() => setFormStep(3)}>
                      <FontAwesomeIcon icon={faArrowLeft} className="me-2" /> Back to Options
                    </Button>
                  </div>
                </div>
              )}

              {(formData.exchange !== "NFO" || formStep === 4) && (
                <div className="fade-in">
                  <h4 className="text-success mb-3"><FontAwesomeIcon icon={faShoppingCart} /> Step 4: Set Trade Conditions</h4>
                  <p className="text-muted"><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, OI: {marketData.oi}, Volume: {marketData.volume}, Last Update: {marketData.timestamp}</p>
                  <Form>
                    <Row className="mb-3 g-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Buy Condition Type</Form.Label>
                          <Form.Select value={formData.buy_type} onChange={(e) => setFormData({ ...formData, buy_type: e.target.value })} className="rounded">
                            <option value="Fixed">Fixed Price (e.g., ₹110)</option>
                            <option value="Percentage">Percentage Increase (e.g., 5%)</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>{formData.buy_type === "Fixed" ? "Buy Threshold" : "Buy % Increase"}</Form.Label>
                          <Form.Control type="number" value={formData.buy_threshold} onChange={(e) => setFormData({ ...formData, buy_threshold: parseFloat(e.target.value) || 0 })} required className="rounded" />
                        </Form.Group>
                      </Col>
                      {formData.buy_type === "Percentage" && (
                        <Col md={4}>
                          <Form.Group>
                            <Form.Label>Previous Close</Form.Label>
                            <Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} required className="rounded" />
                          </Form.Group>
                        </Col>
                      )}
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Product Type</Form.Label>
                          <Form.Select value={formData.producttype} onChange={(e) => setFormData({ ...formData, producttype: e.target.value })} className="rounded">
                            <option value="INTRADAY">MIS (Intraday)</option>
                            <option value="C">CNC (Cash and Carry)</option>
                            <option value="M">NRML (Normal)</option>
                            <option value="B">Bracket Order</option>
                            <option value="H">Cover Order</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3 g-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Stop-Loss Type</Form.Label>
                          <Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })} className="rounded">
                            <option value="Fixed">Fixed</option>
                            <option value="Percentage">Percentage</option>
                            <option value="Points">Points</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Stop-Loss Value</Form.Label>
                          <Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} required className="rounded" />
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Points Condition</Form.Label>
                          <Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} className="rounded" />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="mb-3 g-3">
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>Sell Condition Type</Form.Label>
                          <Form.Select value={formData.sell_type} onChange={(e) => setFormData({ ...formData, sell_type: e.target.value })} className="rounded">
                            <option value="Fixed">Fixed Price (e.g., ₹90)</option>
                            <option value="Percentage">Percentage Decrease (e.g., 5%)</option>
                          </Form.Select>
                        </Form.Group>
                      </Col>
                      <Col md={4}>
                        <Form.Group>
                          <Form.Label>{formData.sell_type === "Fixed" ? "Sell Threshold" : "Sell % Decrease"}</Form.Label>
                          <Form.Control type="number" value={formData.sell_threshold} onChange={(e) => setFormData({ ...formData, sell_threshold: parseFloat(e.target.value) || 0 })} required className="rounded" />
                        </Form.Group>
                      </Col>
                      {formData.sell_type === "Percentage" && (
                        <Col md={4}>
                          <Form.Group>
                            <Form.Label>Previous Close</Form.Label>
                            <Form.Control type="number" value={formData.previous_close} onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })} required className="rounded" />
                          </Form.Group>
                        </Col>
                      )}
                    </Row>
                    <Row className="mb-3">
                      <Col>
                        <Card className="p-3 bg-light" style={{ borderRadius: "8px", boxShadow: "0 2px 4px rgba(0,0,0,0.1)" }}>
                          <p className="mb-1"><strong>Selected User:</strong> {selectedUsers.join(", ")}</p>
                          <p className="mb-1"><strong>Symbol:</strong> {formData.symbol}</p>
                          <p className="mb-1"><strong>Exchange:</strong> {formData.exchange}</p>
                          <p className="mb-1"><strong>Expiry:</strong> {formData.expiry || "N/A"}</p>
                          {formData.exchange === "NFO" && (
                            <p className="mb-1"><strong>Strike Price:</strong> ₹{formData.strike_price}</p>
                          )}
                          <p className="mb-1"><strong>Option Type:</strong> {formData.option_type || "N/A"}</p>
                          <p className="text-success mb-1"><strong>Buy Condition:</strong> {formData.buy_type === "Fixed" ? `≥ ₹${formData.buy_threshold}` : `≥ ₹${(formData.previous_close * (1 + formData.buy_threshold / 100)).toFixed(2)} (${formData.buy_threshold}%)`}</p>
                          <p className="text-danger mb-1"><strong>Stop-Loss:</strong> {formData.stop_loss_type} at {formData.stop_loss_value} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition})</p>
                          <p className="text-danger mb-1"><strong>Sell Condition:</strong> {formData.sell_type === "Fixed" ? `≤ ₹${formData.sell_threshold}` : `≤ ₹${(formData.previous_close * (1 - formData.sell_threshold / 100)).toFixed(2)} (${formData.sell_threshold}%)`}</p>
                          <p className="mb-1"><strong>Product Type:</strong> {formData.producttype}</p>
                          <p className="mb-0"><strong>Broker:</strong> {users.find(u => u.username === selectedUsers[0])?.broker || "Unknown"}</p>
                        </Card>
                      </Col>
                    </Row>
                    <div className="d-flex gap-2">
                      <Button variant="success" className="rounded-pill" onClick={handleInitiateTrade}>
                        <FontAwesomeIcon icon={faCheck} className="me-2" /> Execute Trade
                      </Button>
                      <Button variant="secondary" className="rounded-pill" onClick={() => setFormStep(formData.exchange === "NFO" ? 3.5 : 2)}>
                        <FontAwesomeIcon icon={faArrowLeft} className="me-2" /> Back
                      </Button>
                    </div>
                  </Form>
                </div>
              )}
            </Card.Body>
          </Card>

          {activeTradeId && (
            <Card className="mt-4 shadow-sm border-0 p-4" style={{ borderRadius: "8px", backgroundColor: "#ffffff" }}>
              <Card.Body>
                <h4 className="text-warning mb-3"><FontAwesomeIcon icon={faExchangeAlt} /> Update Trade Conditions</h4>
                <p className="text-muted"><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, OI: {marketData.oi}, Volume: {marketData.volume}, Last Update: {marketData.timestamp}</p>
                <Form>
                  <Row className="mb-3 g-3">
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Stop-Loss Type</Form.Label>
                        <Form.Select value={formData.stop_loss_type} onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })} className="rounded">
                          <option value="Fixed">Fixed</option>
                          <option value="Percentage">Percentage</option>
                          <option value="Points">Points</option>
                        </Form.Select>
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Stop-Loss Value</Form.Label>
                        <Form.Control type="number" value={formData.stop_loss_value} onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })} className="rounded" />
                      </Form.Group>
                    </Col>
                    <Col md={4}>
                      <Form.Group>
                        <Form.Label>Points Condition</Form.Label>
                        <Form.Control type="number" value={formData.points_condition} onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })} className="rounded" />
                      </Form.Group>
                    </Col>
                  </Row>
                  <Button variant="warning" className="rounded-pill" onClick={handleUpdateConditions}>
                    <FontAwesomeIcon icon={faEdit} className="me-2" /> Update Conditions
                  </Button>
                </Form>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>

      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)} centered className="shadow-lg" style={{ borderRadius: "10px" }}>
        <Modal.Header closeButton className="bg-primary text-white" style={{ borderRadius: "10px 10px 0 0" }}>
          <Modal.Title>Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-4">
          {message.text && <Alert variant={message.type === "success" ? "success" : "danger"} className="mb-3" style={{ borderRadius: "8px" }}>{message.text}</Alert>}
          <Form onSubmit={handleRegisterSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required className="rounded" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required className="rounded" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Broker</Form.Label>
              <Form.Select value={formData.broker} onChange={(e) => setFormData({ ...formData, broker: e.target.value })} className="rounded">
                <option value="Shoonya">Shoonya</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>API Key</Form.Label>
              <Form.Control type="text" value={formData.api_key} onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} required className="rounded" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>TOTP Token</Form.Label>
              <Form.Control type="text" value={formData.totp_token} onChange={(e) => setFormData({ ...formData, totp_token: e.target.value })} required className="rounded" />
            </Form.Group>
            {formData.broker === "Shoonya" && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Vendor Code</Form.Label>
                  <Form.Control type="text" value={formData.vendor_code} onChange={(e) => setFormData({ ...formData, vendor_code: e.target.value })} required className="rounded" />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>IMEI</Form.Label>
                  <Form.Control type="text" value={formData.imei} onChange={(e) => setFormData({ ...formData, imei: e.target.value })} required className="rounded" />
                </Form.Group>
              </>
            )}
            <Form.Group className="mb-3">
              <Form.Label>Default Quantity</Form.Label>
              <Form.Control type="number" value={formData.default_quantity} onChange={(e) => setFormData({ ...formData, default_quantity: e.target.value })} required className="rounded" />
            </Form.Group>
            <Button variant="primary" type="submit" className="rounded-pill w-100">
              <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
            </Button>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

// Define TradingViewWidget component
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
      interval: "D",
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
      <div className="tradingview-widget-copyright">
        <a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" className="text-muted">
          Track all markets on TradingView
        </a>
      </div>
    </div>
  );
});

export default Landing;