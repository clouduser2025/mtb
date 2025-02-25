import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Container, Button, Table, Form, Alert, Modal, Row, Col, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faUserPlus, 
  faUsers, 
  faSignInAlt, 
  faShoppingCart, 
  faExchangeAlt,
  faChartLine, 
  faCalendarAlt, 
  faDollarSign 
} from '@fortawesome/free-solid-svg-icons'; 
import './css/landing.css';

const Landing = () => {
  /********************************************************
   *           STATES & REGISTRATION SETUP              *
   ********************************************************/
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
  const [marketData, setMarketData] = useState({ ltp: 0.0, volume: 0, timestamp: "" });

  const [formData, setFormData] = useState({
    username: "",
    password: "",
    broker: "Shoonya",
    api_key: "",
    totp_token: "",
    vendor_code: "",
    default_quantity: 1,
    imei: "",
    symbol: "NIFTY",
    expiry: "",
    strike_price: 0,
    option_type: "Call",
    tradingsymbol: "",
    symboltoken: "",
    exchange: "NFO",
    buy_type: "Fixed",
    buy_threshold: 110,
    previous_close: 0,
    producttype: "INTRADAY",
    stop_loss_type: "Fixed",
    stop_loss_value: 5.0,
    points_condition: 0,
    sell_type: "Fixed",
    sell_threshold: 90,
  });

  /********************************************************
   *                 API FUNCTIONS                      *
   ********************************************************/

  const fetchUsers = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_users", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error("Error fetching users:", error);
      setMessage({ text: "Failed to fetch users", type: "danger" });
    }
  };

  const fetchOpenPositions = async () => {
    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_trades", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const data = await response.json();
      setOpenTrades(data.trades || []);
    } catch (error) {
      console.error("Error fetching open positions:", error);
      setMessage({ text: "Failed to fetch open positions", type: "danger" });
    }
  };

  const fetchOptionChain = async () => {
    if (!selectedUsers.length || selectedUsers.length > 1) {
      setMessage({ text: "Please select exactly 1 Shoonya user for option trading.", type: "warning" });
      return;
    }

    const username = selectedUsers[0];
    const user = users.find(u => u.username === username);
    if (!user || user.broker !== "Shoonya") {
      setMessage({ text: "Option chain data is only available for Shoonya users.", type: "warning" });
      return;
    }

    try {
      const response = await fetch("https://mtb-8ra9.onrender.com/api/get_shoonya_option_chain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          index_name: formData.symbol,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setOptionChainData(data.data);
        setFormData(prev => ({ ...prev, expiry: data.data[0]?.expiry || "" }));
        setMessage({ text: `Option chain data fetched for ${formData.symbol} based on current LTP!`, type: "success" });
        setFormStep(3);
      } else {
        setMessage({ text: data.message || data.detail || "Failed to fetch option chain", type: "danger" });
      }
    } catch (error) {
      console.error("Error fetching option chain:", error);
      setMessage({ text: "Server error fetching option chain.", type: "danger" });
    }
  };

  const handleSelectStrike = (strikeData, optionType) => {
    const selectedTs = `${formData.symbol}${formData.expiry}${optionType === "CE" ? "CE" : "PE"}${strikeData.strike}`;
    setFormData(prev => ({
      ...prev,
      tradingsymbol: selectedTs,
      symboltoken: optionType === "CE" ? strikeData.ce_token : strikeData.pe_token,
      previous_close: optionType === "CE" ? parseFloat(strikeData.ce_ltp || 0) : parseFloat(strikeData.pe_ltp || 0),
      strike_price: parseFloat(strikeData.strike || 0),
      option_type: optionType === "CE" ? "Call" : "Put",
    }));
    setFormStep(4);
    startMarketUpdates(selectedUsers[0], optionType === "CE" ? strikeData.ce_token : strikeData.pe_token);
  };

  const startMarketUpdates = useCallback((username, symboltoken) => {
    const ws = new WebSocket(`wss://mtb-8ra9.onrender.com/api/websocket/${username}/${symboltoken}`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setMarketData({
          ltp: data.ltp || 0.0,
          volume: data.market_data?.v || 0,
          timestamp: data.market_data?.ft || new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      setMessage({ text: "WebSocket connection failed. Falling back to polling.", type: "warning" });
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(`https://mtb-8ra9.onrender.com/api/get_market_data/${username}/${symboltoken}`);
          if (response.ok) {
            const data = await response.json();
            setMarketData({
              ltp: data.ltp || 0.0,
              volume: data.market_data?.v || 0,
              timestamp: data.market_data?.ft || new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Error polling market data:", error);
          setMessage({ text: "Failed to fetch real-time market data.", type: "danger" });
        }
      }, 1000);
      return () => clearInterval(pollInterval);
    };
    ws.onclose = () => {
      console.log("WebSocket closed. Attempting to reconnect...");
      startMarketUpdates(username, symboltoken);
    };
    return () => ws.close();
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
        imei: formData.imei,
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
        setFormData(prev => ({
          ...prev,
          username: "",
          password: "",
          api_key: "",
          totp_token: "",
          vendor_code: "",
          imei: "",
        }));
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
    if (!selectedUsers.length || selectedUsers.length > 1) {
      setMessage({ text: "Please select exactly 1 Shoonya user.", type: "warning" });
      return;
    }

    try {
      const username = selectedUsers[0];
      const user = users.find(u => u.username === username);
      if (!user || user.broker !== "Shoonya") {
        setMessage({ text: "Only Shoonya users can initiate trades.", type: "warning" });
        return;
      }

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
          sell_threshold: formData.sell_threshold,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setMessage({ text: `Buy trade initiated for ${username} (${user.broker})! Position ID: ${data.position_id}`, type: "success" });
        setActiveTradeId(data.position_id);
        fetchOpenPositions();
        setFormStep(1);
        setSelectedUsers([]);
      } else {
        setMessage({ text: `Failed for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
      }
    } catch (error) {
      console.error("Error initiating trade:", error);
      setMessage({ text: "Server error initiating trade.", type: "danger" });
    }
  };

  const handleUpdateConditions = async () => {
    if (!activeTradeId || !selectedUsers.length) {
      setMessage({ text: "No active trade or users selected for update.", type: "warning" });
      return;
    }

    try {
      const username = selectedUsers[0];
      const user = users.find(u => u.username === username);
      if (!user || user.broker !== "Shoonya") {
        setMessage({ text: "Only Shoonya users can update conditions.", type: "warning" });
        return;
      }

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
        fetchOpenPositions();
      } else {
        setMessage({ text: `Failed to update for ${username} (${user.broker}): ${data.detail}`, type: "danger" });
      }
    } catch (error) {
      console.error("Error updating conditions:", error);
      setMessage({ text: "Server error updating conditions.", type: "danger" });
    }
  };

  /********************************************************
   *                 SUB-COMPONENTS                     *
   ********************************************************/

  const UserActionsDropdown = ({ setShowRegisterModal, setShowUsers, showUsers }) => (
    <Dropdown as={ButtonGroup} className="user-dropdown">
      <Dropdown.Toggle variant="primary" id="dropdown-basic">
        <FontAwesomeIcon icon={faUserCog} />
      </Dropdown.Toggle>
      <Dropdown.Menu>
        <Dropdown.Item onClick={() => setShowRegisterModal(true)}>
          <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
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

  /********************************************************
   *                     RENDER (JSX)                     *
   ********************************************************/

  useEffect(() => {
    fetchUsers();
    fetchOpenPositions();
  }, []);

  return (
    <Container fluid className="p-0 wow-container">
      {/* Optional Header - Toggle this based on your needs to avoid duplication with Layout.js */}
      <header className="header wow-header">
        <div className="header-content">
          <span className="header-title">ADPTAI Multi Broker Trading Platform</span>
          <div className="header-actions">
            <Button variant="primary" className="header-btn" onClick={() => alert("Admin Panel coming soon!")}>
              <FontAwesomeIcon icon={faUserCog} /> Admin
            </Button>
            <Button variant="primary" className="header-btn ms-2" onClick={() => alert("Logging out...")}>
              Logout
            </Button>
            <UserActionsDropdown setShowRegisterModal={setShowRegisterModal} setShowUsers={setShowUsers} showUsers={showUsers} />
          </div>
        </div>
      </header>

      {/* Message Alert at the top */}
      {message.text && (
        <Alert 
          variant={message.type === "success" ? "success" : "danger"} 
          className="mt-3 mb-3 wow-alert" 
        >
          {message.text}
        </Alert>
      )}

      {/* Trades Dashboard Button */}
      <Row className="justify-content-center mb-4">
        <Col xs="auto">
          <Button 
            onClick={() => { setShowTradesDashboard(!showTradesDashboard); fetchOpenPositions(); }} 
            className="dashboard-button btn-trades wow-button"
          >
            <FontAwesomeIcon icon={faExchangeAlt} className="me-2" /> Trades Dashboard
          </Button>
        </Col>
      </Row>

      {/* Users Table */}
      {showUsers && (
        <Container className="users-table-container mb-5 wow-section">
          <h3 className="text-center mb-4 text-primary wow-title">
            <FontAwesomeIcon icon={faUsers} className="me-2" /> Registered Users
          </h3>
          <div className="table-responsive">
            <Table striped bordered hover className="custom-table wow-table">
              <thead>
                <tr>
                  <th className="table-header bg-primary text-white">#</th>
                  <th className="table-header bg-success text-white">Username</th>
                  <th className="table-header bg-info text-white">Broker</th>
                  <th className="table-header bg-warning text-dark">Default Quantity</th>
                  <th className="table-header bg-danger text-white">Vendor Code</th>
                  <th className="table-header bg-dark text-white">IMEI</th>
                  <th className="table-header bg-secondary text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length > 0 ? (
                  users.map((user, index) => (
                    <tr key={index} className="table-row wow-row">
                      <td>{index + 1}</td>
                      <td>{user.username}</td>
                      <td>{user.broker}</td>
                      <td>{user.default_quantity}</td>
                      <td>{user.broker === "Shoonya" ? user.vendor_code || "N/A" : "N/A"}</td>
                      <td>{user.broker === "Shoonya" ? user.imei || "N/A" : "N/A"}</td>
                      <td>
                        <Button variant="danger" size="sm" className="btn-delete wow-button" onClick={() => handleDeleteUser(user.username)}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="text-muted text-center">No registered users found.</td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </Container>
      )}

      {/* Trades Dashboard */}
      {showTradesDashboard && (
        <Container className="mt-5 p-4 traders-table-container shadow-lg rounded bg-white wow-section">
          <h3 className="text-center mb-4 text-dark fw-bold wow-title">
            <FontAwesomeIcon icon={faExchangeAlt} className="me-2 text-primary" /> Active Trades
          </h3>
          <div className="table-responsive">
            <Table striped bordered hover className="custom-table wow-table">
              <thead>
                <tr>
                  <th className="table-header bg-primary text-white">#</th>
                  <th className="table-header bg-success text-white">Username</th>
                  <th className="table-header bg-info text-white">Symbol</th>
                  <th className="table-header bg-dark text-white">Entry Price</th>
                  <th className="table-header bg-danger text-white">Buy Threshold</th>
                  <th className="table-header bg-secondary text-white">Stop-Loss Type</th>
                  <th className="table-header bg-primary text-white">Stop-Loss Value</th>
                  <th className="table-header bg-warning text-dark">Sell Threshold</th>
                  <th className="table-header bg-success text-white">Position</th>
                  <th className="table-header bg-info text-white">Broker</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.length > 0 ? (
                  openTrades.map((trade, index) => (
                    <tr key={index} className="table-row wow-row align-middle text-center">
                      <td>{index + 1}</td>
                      <td className="fw-bold text-warning">{trade.username}</td>
                      <td className="text-primary">{trade.symbol}</td>
                      <td className="text-success fw-bold">₹{trade.entry_price || 0}</td>
                      <td className="text-danger fw-bold">₹{trade.buy_threshold || "N/A"}</td>
                      <td className="text-warning">{trade.stop_loss_type || "N/A"}</td>
                      <td className="text-info">{trade.stop_loss_value || "N/A"}</td>
                      <td className="text-danger fw-bold">₹{trade.sell_threshold || "N/A"}</td>
                      <td><span className="badge bg-success">Buy</span></td>
                      <td>{users.find(u => u.username === trade.username)?.broker || "Unknown"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="text-muted text-center">No active trades found.</td>
                  </tr>
                )}
              </tbody>
            </Table>
          </div>
        </Container>
      )}

      {/* Multi-Step Trade Form */}
      <Container className="mt-4 p-4 border rounded wow-form">
        {formStep === 1 && (
          <>
            <h4 className="text-primary wow-title">
              <FontAwesomeIcon icon={faUsers} className="me-2" /> Step 1: Select Shoonya User (1 only)
            </h4>
            <Form className="wow-form-content">
              <Row className="mb-4">
                <Col>
                  {users.filter(user => user.broker === "Shoonya").map((user, index) => (
                    <Form.Check
                      key={index}
                      type="checkbox"
                      label={user.username}
                      checked={selectedUsers.includes(user.username)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (selectedUsers.length < 1) {
                            setSelectedUsers([user.username]);
                          } else {
                            alert("⚠ You can only select 1 Shoonya user for option trading.");
                          }
                        } else {
                          setSelectedUsers([]);
                        }
                      }}
                      className="wow-checkbox"
                    />
                  ))}
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={() => {
                  if (selectedUsers.length === 0) {
                    alert("Please select exactly 1 Shoonya user.");
                  } else {
                    setFormStep(2);
                  }
                }}
                className="wow-button mt-3"
              >
                Next
              </Button>
            </Form>
          </>
        )}

        {formStep === 2 && (
          <>
            <h4 className="text-primary wow-title">
              <FontAwesomeIcon icon={faChartLine} className="me-2" /> Step 2: Select Index
            </h4>
            <Form className="wow-form-content">
              <Row className="mb-4">
                <Col md={6}>
                  <Form.Group controlId="symbol">
                    <Form.Label className="wow-label">Index</Form.Label>
                    <Form.Select 
                      value={formData.symbol} 
                      onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
                      required
                      className="wow-input"
                    >
                      <option value="NIFTY">NIFTY</option>
                      <option value="BANKNIFTY">BANKNIFTY</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
              <Button 
                variant="primary" 
                onClick={fetchOptionChain}
                className="wow-button mt-3"
              >
                Fetch Option Chain
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => { setFormStep(1); setSelectedUsers([]); setOptionChainData(null); }}
                className="wow-button mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}

        {formStep === 3 && optionChainData && (
          <>
            <h4 className="text-success wow-title">
              <FontAwesomeIcon icon={faChartLine} className="me-2" /> Step 3: Option Chain Data (Expiry: {formData.expiry})
            </h4>
            <Table striped bordered hover className="custom-table wow-table">
              <thead>
                <tr>
                  <th className="table-header bg-primary text-white">CE OI</th>
                  <th className="table-header bg-success text-white">CE LTP</th>
                  <th className="table-header bg-info text-white">Strike</th>
                  <th className="table-header bg-dark text-white">PE LTP</th>
                  <th className="table-header bg-danger text-white">PE OI</th>
                  <th className="table-header bg-secondary text-white">Action</th>
                </tr>
              </thead>
              <tbody>
                {optionChainData.map((strikeData, index) => (
                  <tr key={index} className="table-row wow-row">
                    <td>{strikeData.ce_oi || "N/A"}</td>
                    <td>{strikeData.ce_ltp || "N/A"}</td>
                    <td>{strikeData.strike || "N/A"}</td>
                    <td>{strikeData.pe_ltp || "N/A"}</td>
                    <td>{strikeData.pe_oi || "N/A"}</td>
                    <td>
                      <ButtonGroup>
                        <Button 
                          variant="primary" 
                          size="sm" 
                          onClick={() => handleSelectStrike(strikeData, "CE")}
                          className="wow-button me-1"
                        >
                          Call
                        </Button>
                        <Button 
                          variant="secondary" 
                          size="sm" 
                          onClick={() => handleSelectStrike(strikeData, "PE")}
                          className="wow-button"
                        >
                          Put
                        </Button>
                      </ButtonGroup>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Button 
              variant="secondary" 
              onClick={() => setFormStep(2)}
              className="wow-button mt-3"
            >
              Back
            </Button>
          </>
        )}

        {formStep === 4 && (
          <>
            <h4 className="text-success wow-title">
              <FontAwesomeIcon icon={faShoppingCart} className="me-2" /> Step 4: Set Buy, Stop-Loss, and Sell Conditions (Live Market Data)
            </h4>
            <p className="wow-live-data"><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, Volume: {marketData.volume}, Last Update: {new Date(marketData.timestamp).toLocaleString()}</p>
            <Form className="wow-form-content">
              <Row className="mb-4">
                <Col md={4}>
                  <Form.Group controlId="buy_type">
                    <Form.Label className="wow-label">Buy Condition Type</Form.Label>
                    <Form.Select 
                      value={formData.buy_type} 
                      onChange={(e) => setFormData({ ...formData, buy_type: e.target.value })}
                      className="wow-input"
                    >
                      <option value="Fixed">Fixed Price (e.g., ₹110)</option>
                      <option value="Percentage">Percentage Increase (e.g., 5%)</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="buy_threshold">
                    <Form.Label className="wow-label">{formData.buy_type === "Fixed" ? "Buy Threshold" : "Buy % Increase"}</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={formData.buy_threshold} 
                      onChange={(e) => setFormData({ ...formData, buy_threshold: parseFloat(e.target.value) || 0 })}
                      required 
                      className="wow-input"
                    />
                  </Form.Group>
                </Col>
                {formData.buy_type === "Percentage" && (
                  <Col md={4}>
                    <Form.Group controlId="previous_close">
                      <Form.Label className="wow-label">Previous Close</Form.Label>
                      <Form.Control 
                        type="number" 
                        value={formData.previous_close} 
                        onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })}
                        required 
                        className="wow-input"
                      />
                    </Form.Group>
                  </Col>
                )}
                <Col md={4}>
                  <Form.Group controlId="producttype">
                    <Form.Label className="wow-label">Product Type</Form.Label>
                    <Form.Select 
                      value={formData.producttype} 
                      onChange={(e) => setFormData({ ...formData, producttype: e.target.value })}
                      className="wow-input"
                    >
                      <option value="INTRADAY">MIS (Intraday)</option>
                      <option value="C">CNC (Cash and Carry)</option>
                      <option value="M">NRML (Normal)</option>
                      <option value="B">Bracket Order</option>
                      <option value="H">Cover Order</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-4">
                <Col md={4}>
                  <Form.Group controlId="stop_loss_type">
                    <Form.Label className="wow-label">Stop-Loss Type</Form.Label>
                    <Form.Select 
                      value={formData.stop_loss_type} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}
                      className="wow-input"
                    >
                      <option value="Fixed">Fixed</option>
                      <option value="Percentage">Percentage</option>
                      <option value="Points">Points</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="stop_loss_value">
                    <Form.Label className="wow-label">Stop-Loss Value</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={formData.stop_loss_value} 
                      onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })}
                      required 
                      className="wow-input"
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="points_condition">
                    <Form.Label className="wow-label">Points Condition</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={formData.points_condition} 
                      onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })}
                      className="wow-input"
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Row className="mb-4">
                <Col md={4}>
                  <Form.Group controlId="sell_type">
                    <Form.Label className="wow-label">Sell Condition Type</Form.Label>
                    <Form.Select 
                      value={formData.sell_type} 
                      onChange={(e) => setFormData({ ...formData, sell_type: e.target.value })}
                      className="wow-input"
                    >
                      <option value="Fixed">Fixed Price (e.g., ₹90)</option>
                      <option value="Percentage">Percentage Decrease (e.g., 5%)</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group controlId="sell_threshold">
                    <Form.Label className="wow-label">{formData.sell_type === "Fixed" ? "Sell Threshold" : "Sell % Decrease"}</Form.Label>
                    <Form.Control 
                      type="number" 
                      value={formData.sell_threshold} 
                      onChange={(e) => setFormData({ ...formData, sell_threshold: parseFloat(e.target.value) || 0 })}
                      required 
                      className="wow-input"
                    />
                  </Form.Group>
                </Col>
                {formData.sell_type === "Percentage" && (
                  <Col md={4}>
                    <Form.Group controlId="previous_close">
                      <Form.Label className="wow-label">Previous Close</Form.Label>
                      <Form.Control 
                        type="number" 
                        value={formData.previous_close} 
                        onChange={(e) => setFormData({ ...formData, previous_close: parseFloat(e.target.value) || 0 })}
                        required 
                        className="wow-input"
                      />
                    </Form.Group>
                  </Col>
                )}
              </Row>
              <Row className="mb-4">
                <Col>
                  <div className="wow-summary">
                    <p><strong>Selected User:</strong> {selectedUsers.join(", ") || "N/A"}</p>
                    <p><strong>Index:</strong> {formData.symbol}</p>
                    <p><strong>Expiry:</strong> {formData.expiry || "N/A"}</p>
                    <p><strong>Strike Price:</strong> ₹{formData.strike_price || 0}</p>
                    <p><strong>Option Type:</strong> {formData.option_type || "N/A"}</p>
                    <p style={{ color: "green" }}><strong>Buy Condition:</strong> {formData.buy_type === "Fixed" ? 
                      `≥ ₹${formData.buy_threshold || 0}` : 
                      `≥ ₹${((formData.previous_close || 0) * (1 + (formData.buy_threshold || 0) / 100)).toFixed(2)} (${formData.buy_threshold || 0}%)`}
                    </p>
                    <p style={{ color: "red" }}><strong>Stop-Loss:</strong> {formData.stop_loss_type} at {formData.stop_loss_value || 0} {formData.stop_loss_type === "Percentage" ? "%" : ""} (Points: {formData.points_condition || 0})</p>
                    <p style={{ color: "red" }}><strong>Sell Condition:</strong> {formData.sell_type === "Fixed" ? 
                      `≤ ₹${formData.sell_threshold || 0}` : 
                      `≤ ₹${((formData.previous_close || 0) * (1 - (formData.sell_threshold || 0) / 100)).toFixed(2)} (${formData.sell_threshold || 0}%)`}
                    </p>
                    <p><strong>Product Type:</strong> {formData.producttype}</p>
                    <p><strong>Broker:</strong> {users.find(u => u.username === selectedUsers[0])?.broker || "Unknown"}</p>
                  </div>
                </Col>
              </Row>
              <Button 
                variant="success" 
                onClick={handleInitiateTrade}
                className="wow-button mt-3"
              >
                Execute Trade
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => setFormStep(3)}
                className="wow-button mt-3 ms-2"
              >
                Back
              </Button>
            </Form>
          </>
        )}
      </Container>

      {activeTradeId && (
        <Container className="mt-4 p-4 border rounded wow-form">
          <h4 className="text-warning wow-title">
            <FontAwesomeIcon icon={faExchangeAlt} className="me-2" /> Update Stop-Loss Conditions (Live Market Data)
          </h4>
          <p className="wow-live-data"><strong>Live Market Data:</strong> LTP: ₹{marketData.ltp.toFixed(2)}, Volume: {marketData.volume}, Last Update: {new Date(marketData.timestamp).toLocaleString()}</p>
          <Form className="wow-form-content">
            <Row className="mb-4">
              <Col md={4}>
                <Form.Group controlId="stop_loss_type">
                  <Form.Label className="wow-label">Stop-Loss Type</Form.Label>
                  <Form.Select 
                    value={formData.stop_loss_type} 
                    onChange={(e) => setFormData({ ...formData, stop_loss_type: e.target.value })}
                    className="wow-input"
                  >
                    <option value="Fixed">Fixed</option>
                    <option value="Percentage">Percentage</option>
                    <option value="Points">Points</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="stop_loss_value">
                  <Form.Label className="wow-label">Stop-Loss Value</Form.Label>
                  <Form.Control 
                    type="number" 
                    value={formData.stop_loss_value} 
                    onChange={(e) => setFormData({ ...formData, stop_loss_value: parseFloat(e.target.value) || 0 })}
                    className="wow-input"
                  />
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="points_condition">
                  <Form.Label className="wow-label">Points Condition</Form.Label>
                  <Form.Control 
                    type="number" 
                    value={formData.points_condition} 
                    onChange={(e) => setFormData({ ...formData, points_condition: parseFloat(e.target.value) || 0 })}
                    className="wow-input"
                  />
                </Form.Group>
              </Col>
            </Row>
            <Button 
              variant="warning" 
              onClick={handleUpdateConditions}
              className="wow-button mt-3"
            >
              Update Conditions
            </Button>
          </Form>
        </Container>
      )}

      {/* Registration Modal */}
      <Modal show={showRegisterModal} onHide={() => setShowRegisterModal(false)} className="wow-modal">
        <Modal.Header closeButton className="wow-modal-header">
          <Modal.Title className="wow-title">Register User</Modal.Title>
        </Modal.Header>
        <Modal.Body className="wow-modal-body">
          {message.text && (
            <Alert 
              variant={message.type === "success" ? "success" : "danger"} 
              style={{ backgroundColor: message.type === "success" ? "#d4edda" : "#f8d7da", color: message.type === "success" ? "#155724" : "#721c24" }}
              className="wow-alert"
            >
              {message.text}
            </Alert>
          )}
          <Form onSubmit={handleRegisterSubmit} className="wow-form-content">
            <Form.Group controlId="username" className="mb-3">
              <Form.Label className="wow-label">Username</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter username" 
                value={formData.username} 
                onChange={(e) => setFormData({ ...formData, username: e.target.value })} 
                required 
                className="wow-input"
              />
            </Form.Group>
            <Form.Group controlId="password" className="mb-3">
              <Form.Label className="wow-label">Password</Form.Label>
              <Form.Control 
                type="password" 
                placeholder="Enter password" 
                value={formData.password} 
                onChange={(e) => setFormData({ ...formData, password: e.target.value })} 
                required 
                className="wow-input"
              />
            </Form.Group>
            <Form.Group controlId="broker" className="mb-3">
              <Form.Label className="wow-label">Broker</Form.Label>
              <Form.Select 
                value={formData.broker} 
                onChange={(e) => setFormData({ ...formData, broker: e.target.value, vendor_code: "", imei: "" })}
                className="wow-input"
              >
                <option value="Shoonya">Shoonya</option>
              </Form.Select>
            </Form.Group>
            <Form.Group controlId="api_key" className="mb-3">
              <Form.Label className="wow-label">API Key</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter API Key" 
                value={formData.api_key} 
                onChange={(e) => setFormData({ ...formData, api_key: e.target.value })} 
                required 
                className="wow-input"
              />
            </Form.Group>
            <Form.Group controlId="totp_token" className="mb-3">
              <Form.Label className="wow-label">TOTP Token</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter TOTP Token (Base32, e.g., JBSWY3DPEHPK3PXP)" 
                value={formData.totp_token} 
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().replace(/[^A-Z2-7]/g, ''); // Clean non-Base32 chars
                  setFormData({ ...formData, totp_token: value });
                }} 
                required 
                className="wow-input"
              />
            </Form.Group>
            {formData.broker === "Shoonya" && (
              <>
                <Form.Group controlId="vendor_code" className="mb-3">
                  <Form.Label className="wow-label">Vendor Code</Form.Label>
                  <Form.Control 
                    type="text" 
                    placeholder="Enter Vendor Code" 
                    value={formData.vendor_code} 
                    onChange={(e) => setFormData({ ...formData, vendor_code: e.target.value })} 
                    required 
                    className="wow-input"
                  />
                </Form.Group>
                <Form.Group controlId="imei" className="mb-3">
                  <Form.Label className="wow-label">IMEI</Form.Label>
                  <Form.Control 
                    type="text" 
                    placeholder="Enter IMEI" 
                    value={formData.imei} 
                    onChange={(e) => setFormData({ ...formData, imei: e.target.value })} 
                    required 
                    className="wow-input"
                  />
                </Form.Group>
              </>
            )}
            <Form.Group controlId="default_quantity" className="mb-3">
              <Form.Label className="wow-label">Default Quantity</Form.Label>
              <Form.Control 
                type="number" 
                placeholder="Enter Quantity" 
                value={formData.default_quantity} 
                onChange={(e) => setFormData({ ...formData, default_quantity: parseInt(e.target.value) || 1 })} 
                required 
                className="wow-input"
              />
            </Form.Group>
            <Button variant="primary" type="submit" className="wow-button mt-3">Register</Button>
          </Form>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default Landing;